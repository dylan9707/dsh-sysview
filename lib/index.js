import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'sysview';
export const inject = ['tools', 'systemPrompt'];
export const Config = z.object({
  graphPath: z.string().default('ai_notes/diagrams/system_graph.json'),
});
const WEB_KEYS = ['webServer', 'httpServer'];
const WS_KEYS = ['workspaceRegistry', 'workspace'];

function editorHtmlPath() {
  return fileURLToPath(new URL('../assets/editor.html', import.meta.url));
}

const USAGE_SECTION = [
  'When the user runs "sys-view <scope>" (also "sys view <scope>" or "run sys-view <scope>"), you are the system decomposer. Read the actual OOP code and emit a system view (panorama or signal flow), then persist it with system_overview_save so the System View panel shows it.',
  '',
  'Scopes:',
  '- "fsm" / "system" / "architecture": the whole system as a whiteboard PANORAMA (diagramType "panorama"). One colored CENTER node = the hub (e.g. SpvrApp); REGION containers (pill titles) hold white CARDS, one per major component, grouped by role (输入与命令, 进程监督, 运动控制, 通信传输, 执行机构, 数据总线...); CURVED arrows with plain Chinese labels carry the data/control flow. Ground every card in real code (grep + read .h/.cpp); do not fabricate components.',
  '- "safety" / "safety system": safety as a SIGNAL FLOW (diagramType "signalFlow") — blocks = safety processing stages (BaseSafetyBlock, checkXXX, addError + errLevelOf, exec* 五档写位, DataLogChannel/Data), edges = the flowing signal (主循环读位 holdNow/safe, Comm 新鲜度, MCU MOTOR_DISABLE).',
  '- "signal flow" / "signalflow": the SIGNAL flow — blocks = signal processing stages, edges = the flowing signal (e.g. check -> addError(code) -> errLevelOf(等级) -> 记录/动作 -> 主循环读位 -> MCU MOTOR_DISABLE).',
  '- "panorama" / "whiteboard" / "workflow": the whiteboard-style system panorama — colored region containers (pill titles) hold white cards (title + bullets with code chips), plus one center node and bottom document preview cards; edges are curved arrows with plain Chinese labels. This is a free-form workflow canvas, not tied to one codebase; seed it from a spec or design the user shows you.',
  '',
  'Emit (pass to system_overview_save):',
  '- diagramType: "panorama" for fsm/system/architecture/whiteboard; "signalFlow" for safety/signal flow.',
  '- content (signalFlow): JSON string {nodes:[{id,label,sub,type,x,y,w,h}], edges:[{id,from,to,label,type}]}',
  '  node.type in process|control|sensor|actuator|data-store|external; edge.type in signal|control|data.',
  '  For "panorama": nodes = {id, kind: region|card|center|doc, color: cyan|green|rose|red|blue|orange|purple|gray, title, x,y,w,h} + per-kind fields (region: en; card: bullets[]; center: sub+bullets; doc: filename+sub+body); edges = {id, from, to, label, color, dash}.',
  '  x/y/w/h = rough layout (left-to-right); "sub" = one-line role. Keep GENEROUS spacing between blocks: >=100px gaps between adjacent process/container blocks (columns and rows), >=40px outer margin, and enough interior padding in container blocks so member blocks do not touch the container edges. Blocks must never overlap; children coordinates are OFFSETS relative to the parent top-left.',
  'Ground each block in real code (grep + read .h/.cpp); do not fabricate members. Use system_overview_load first to see the current diagram.',
  '',
  'When the user edits the signal flow / panorama in the panel and asks for a plan (e.g. "根据我改的图出计划" / "按这个架构改代码" / "读图出改动计划" / "按我画的 workflow 改"), call system_overview_load to read the current diagram, treat the user\'s edits as the TARGET design, diff it against what the code actually has, and produce a code-modification plan: which files/classes/members to add/remove/change, and why. Follow the repo two-gate rule (present the plan and wait for approval) before editing any code.',
  '',
  'When the user clicks "Update Agent" in the System View panel, the plugin writes ai_notes/agent_briefs/system-view-update-pending.json (edited signalFlow/panorama + timestamp). On the next turn, read that marker plus system_overview_load, treat the edited diagram as the target design, diff it against the actual code, and produce 改动确认 + 详细设计 plan (files/classes/members to add/remove/change and why), then wait for approval (repo two-gate rule).',
].join('\n');

export function apply(ctx, config) {
  const graphPath = config.graphPath ?? 'ai_notes/diagrams/system_graph.json';

  ctx.systemPrompt.section({ name: 'sysview:usage', order: 118, text: USAGE_SECTION });

  function workspaceDir(exec) {
    const ws = ctx.get(WS_KEYS[0]) ?? ctx.get(WS_KEYS[1]);
    if (ws) {
      try { const list = ws.list(); if (list && list.length) return list[0].path; } catch {}
    }
    return exec?.agent?.session?.header?.cwd ?? process.cwd();
  }

  ctx.tools.register(defineTool({
    name: 'system_overview_save',
    description: 'Persist a generated system-view diagram (signal flow or panorama) to the System View panel. The agent generates nodes/edges by reading the code; this tool writes them to the workspace graph file the editor displays. Pass content as a JSON string {nodes:[...], edges:[...]}.',
    parameters: {
      diagramType: { type: 'string', required: true, description: '"signalFlow" (signal flow) or "panorama" (whiteboard workflow panorama).' },
      content: { type: 'string', required: true, description: 'JSON string {nodes:[{id,label,sub,type,x,y,w,h}], edges:[{id,from,to,label,type}]}.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
      render: (args, value) => [{ type: 'text', text: 'sys-view saved to ' + value.path }],
    },
    async execute(args, exec) {
      const target = join(workspaceDir(exec), graphPath);
      let doc = { version: 2 };
      try { doc = JSON.parse(await readFile(target, 'utf8')); } catch { doc = { version: 2 }; }
      const parsed = JSON.parse(args.content);
      doc[args.diagramType] = { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
      doc.version = 2;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(doc, null, 2), 'utf8');
      return { path: target };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'system_overview_load',
    description: 'Read the current System View diagrams (signal flow + panorama) so the agent can inspect them, or diff the user edits against the code to produce a modification plan.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value).slice(0, 400) }],
    },
    async execute(args, exec) {
      const target = join(workspaceDir(exec), graphPath);
      try { return JSON.parse(await readFile(target, 'utf8')); }
      catch { return { version: 2, signalFlow: { nodes: [], edges: [] }, panorama: { nodes: [], edges: [] } }; }
    },
  }));

  let registered = false;
  const register = () => {
    if (registered) return;
    const web = ctx.get(WEB_KEYS[0]) ?? ctx.get(WEB_KEYS[1]);
    const ws = ctx.get(WS_KEYS[0]) ?? ctx.get(WS_KEYS[1]);
    if (web === undefined || ws === undefined) return;
    registered = true;

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/plugins/sysview/graph',
      handler: async (req, res) => {
        try {
          const roots = ws.list().map((w) => w.path);
          const target = join(roots[0] ?? process.cwd(), graphPath);
          if (req.method === 'GET') {
            let data;
            try { data = await readFile(target, 'utf8'); }
            catch { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end('{}'); return; }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(data);
          } else if (req.method === 'POST') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', async () => {
              await mkdir(dirname(target), { recursive: true });
              await writeFile(target, body, 'utf8');
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true, path: target }));
            });
          } else { res.writeHead(405); res.end(); }
        } catch (error) {
          ctx.logger?.warn?.('sysview: ' + String(error));
          res.writeHead(500); res.end(String(error));
        }
      },
    }), 'sysview: graph route');

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/plugins/sysview/editor',
      handler: async (_req, res) => {
        try {
          const html = await readFile(editorHtmlPath(), 'utf8');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(html);
        } catch (error) { res.writeHead(500); res.end(String(error)); }
      },
    }), 'sysview: editor route');

    ctx.effect(() => web.register({
      kind: 'exact',
      path: '/plugins/sysview/agent-update',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        try {
          const roots = ws.list().map((w) => w.path);
          const root = roots[0] ?? process.cwd();
          const target = join(root, graphPath);
          const markerPath = join(root, 'ai_notes/agent_briefs/system-view-update-pending.json');
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', async () => {
            let doc = {};
            try { doc = JSON.parse(body); } catch { /* 非 JSON 也照存图 */ }
            await mkdir(dirname(target), { recursive: true });
            await mkdir(dirname(markerPath), { recursive: true });
            await writeFile(target, body, 'utf8');
            const marker = {
              requestedAt: new Date().toISOString(),
              requestedBy: 'sysview-panel',
              note: 'user clicked "Update Agent" in the System View panel after editing the diagram',
              signalFlow: doc.signalFlow ?? null,
              panorama: doc.panorama ?? null,
            };
            await writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');
            ctx.logger?.info?.('sysview: user requested agent update -> ' + markerPath);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, path: markerPath }));
          });
        } catch (error) {
          ctx.logger?.warn?.('sysview: ' + String(error));
          res.writeHead(500); res.end(String(error));
        }
      },
    }), 'sysview: agent-update route');
  };
  register();
  ctx.on('internal/service', (name) => {
    if (WEB_KEYS.includes(name) || WS_KEYS.includes(name)) register();
  });
}
