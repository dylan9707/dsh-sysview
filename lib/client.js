window.__ModuleLoader__.load({
  id: "@infmed/dsh-sysview",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    exports.inject = [];

    exports.apply = function apply(ctx) {
      let panel = null;

      const fab = document.createElement('button');
      fab.textContent = 'System View';
      fab.dataset.systemViewFab = '';
      Object.assign(fab.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483000',
        background: '#1c3d5a', color: '#fff', border: 'none', borderRadius: '20px',
        padding: '10px 16px', cursor: 'pointer', fontFamily: 'sans-serif', fontSize: '13px',
        boxShadow: '0 4px 12px rgba(0,0,0,.25)',
      });

      function close() {
        if (panel) { panel.remove(); panel = null; }
        fab.style.display = '';
      }
      function open() {
        if (panel) return;
        fab.style.display = 'none';
        panel = document.createElement('div');
        panel.dataset.systemViewPanel = '';
        Object.assign(panel.style, {
          position: 'fixed', right: '16px', bottom: '16px',
          width: '760px', maxWidth: '96vw', height: '78vh',
          zIndex: '2147483000', background: '#fff', border: '1px solid #ccc',
          borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        });
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#1c3d5a;color:#fff;cursor:move;user-select:none;flex:none;';
        header.innerHTML = '<strong>System View</strong><button data-sv-close style="border:none;background:transparent;color:#fff;font-size:16px;cursor:pointer;line-height:1;">&#10005;</button>';
        header.querySelector('[data-sv-close]').addEventListener('click', close);

        // 快捷尺寸按钮（小/中/大）+ 尺寸记忆（localStorage）
        const SIZES = [
          { label: '小', width: '520px',  height: '58vh' },
          { label: '中', width: '760px',  height: '78vh' },
          { label: '大', width: '94vw',   height: '94vh' },
        ];
        function saveSize() {
          try {
            localStorage.setItem('sysview.panel.size', JSON.stringify({
              width: panel.style.width || (panel.offsetWidth + 'px'),
              height: panel.style.height || (panel.offsetHeight + 'px'),
            }));
          } catch (e) { /* localStorage 不可用时静默 */ }
        }
        function loadSize() {
          try {
            const raw = localStorage.getItem('sysview.panel.size');
            if (!raw) return;
            const o = JSON.parse(raw);
            if (o.width) panel.style.width = o.width;
            if (o.height) panel.style.height = o.height;
          } catch (e) { /* 损坏数据忽略 */ }
        }
        const sizeBox = document.createElement('span');
        sizeBox.style.cssText = 'display:flex;gap:4px;';
        SIZES.forEach((s) => {
          const b = document.createElement('button');
          b.textContent = s.label;
          b.title = '窗口尺寸：' + s.label;
          b.style.cssText = 'border:none;background:#2f5f8a;color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;';
          b.addEventListener('click', () => {
            panel.style.width = s.width;
            panel.style.height = s.height;
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '16px';
            panel.style.bottom = '16px';
            saveSize();
          });
          sizeBox.appendChild(b);
        });
        header.insertBefore(sizeBox, header.querySelector('[data-sv-close]'));

        // 拖动 header 移动窗口（pointer capture：光标移进 iframe 也不断拖）
        header.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button')) return;   // 关闭/尺寸按钮不触发拖动
          const dx = e.clientX - panel.offsetLeft;
          const dy = e.clientY - panel.offsetTop;
          header.setPointerCapture(e.pointerId);
          const move = (ev) => {
            panel.style.left = (ev.clientX - dx) + 'px';
            panel.style.top = (ev.clientY - dy) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
          };
          const up = () => {
            header.releasePointerCapture(e.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        const frame = document.createElement('iframe');
        frame.src = '/plugins/sysview/editor';
        Object.assign(frame.style, { width: '100%', height: '100%', border: 'none', flex: '1' });
        panel.appendChild(header);
        panel.appendChild(frame);

        // 边框 + 四角调整大小（pointer capture：光标移进 iframe 也不断拖）
        // cfg: growRight/growDown 决定拖动方向；fixedW/fixedH 锁定单轴
        function makeResizeHandle(cfg) {
          const h = document.createElement('div');
          Object.assign(h.style, cfg.style, {
            position: 'absolute', cursor: cfg.cursor, touchAction: 'none',
          });
          h.title = '拖拽调整尺寸';
          h.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX, startY = e.clientY;
            const startW = panel.offsetWidth, startH = panel.offsetHeight;
            const startLeft = panel.offsetLeft, startTop = panel.offsetTop;
            // 切到 left/top 锚定（此时 offsetLeft/Top 即实际位置，视觉不变）
            panel.style.left = startLeft + 'px';
            panel.style.top = startTop + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            h.setPointerCapture(e.pointerId);
            const move = (ev) => {
              const dX = ev.clientX - startX, dY = ev.clientY - startY;
              const nw = cfg.fixedW ? startW : Math.max(360, Math.min(cfg.growRight ? startW + dX : startW - dX, window.innerWidth - 24));
              const nh = cfg.fixedH ? startH : Math.max(240, Math.min(cfg.growDown ? startH + dY : startH - dY, window.innerHeight - 24));
              panel.style.width = nw + 'px';
              panel.style.height = nh + 'px';
              // 对边锚定：往哪边拉，对边不动
              panel.style.left = (cfg.growRight ? startLeft : startLeft + (startW - nw)) + 'px';
              panel.style.top  = (cfg.growDown ? startTop : startTop + (startH - nh)) + 'px';
            };
            const up = () => {
              h.releasePointerCapture(e.pointerId);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              saveSize();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          });
          return h;
        }
        const EDGE_H = { background: 'rgba(47,95,138,0.10)', borderRadius: '2px' };
        const CORNER_H = { background: '#2f5f8a', borderRadius: '3px' };
        const EDGES = [
          { key: 'n', cfg: { growRight: true,  growDown: false, fixedW: true,  style: { left: '12px', right: '12px', top: '0',     height: '5px' },  cursor: 'ns-resize' } },
          { key: 's', cfg: { growRight: true,  growDown: true,  fixedW: true,  style: { left: '12px', right: '12px', bottom: '0',  height: '5px' },  cursor: 'ns-resize' } },
          { key: 'w', cfg: { growRight: false, growDown: true,  fixedH: true,  style: { top: '12px', bottom: '12px', left: '0',    width: '5px' },  cursor: 'ew-resize' } },
          { key: 'e', cfg: { growRight: true,  growDown: true,  fixedH: true,  style: { top: '12px', bottom: '12px', right: '0',   width: '5px' },  cursor: 'ew-resize' } },
        ];
        const CORNERS = [
          { key: 'nw', cfg: { growRight: false, growDown: false, style: { left: '0',    top: '0',    width: '12px', height: '12px' }, cursor: 'nwse-resize' } },
          { key: 'ne', cfg: { growRight: true,  growDown: false, style: { right: '0',   top: '0',    width: '12px', height: '12px' }, cursor: 'nesw-resize' } },
          { key: 'sw', cfg: { growRight: false, growDown: true,  style: { left: '0',    bottom: '0', width: '12px', height: '12px' }, cursor: 'nesw-resize' } },
          { key: 'se', cfg: { growRight: true,  growDown: true,  style: { right: '0',   bottom: '0', width: '12px', height: '12px' }, cursor: 'nwse-resize' } },
        ];
        EDGES.forEach((it) => { const h = makeResizeHandle(it.cfg); Object.assign(h.style, EDGE_H); h.dataset.svEdge = it.key; panel.appendChild(h); });
        CORNERS.forEach((it) => { const h = makeResizeHandle(it.cfg); Object.assign(h.style, CORNER_H); h.dataset.svCorner = it.key; panel.appendChild(h); });

        loadSize();   // 打开时恢复上次窗口尺寸
        document.body.appendChild(panel);
      }

      fab.addEventListener('click', () => { if (panel) close(); else open(); });
      document.body.appendChild(fab);

      function showToast(msg) {
        try {
          const t = document.createElement('div');
          t.textContent = msg;
          Object.assign(t.style, {
            position: 'fixed', left: '50%', bottom: '70px', transform: 'translateX(-50%)',
            zIndex: '2147483001', background: '#1c3d5a', color: '#fff', padding: '8px 16px',
            borderRadius: '6px', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,.3)',
            fontFamily: 'sans-serif', whiteSpace: 'nowrap',
          });
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 5000);
        } catch (e) { /* 忽略 */ }
      }
      const onMessage = (e) => {
        if (e.data === 'system-view:close') close();
        else if (e.data === 'system-view:agent-update') showToast('系统视图已同步给 agent，等待出改动确认与设计 plan');
      };
      window.addEventListener('message', onMessage);

      ctx.effect(() => () => {
        close();
        fab.remove();
        window.removeEventListener('message', onMessage);
      }, 'system-view: panel');
    };

    return module.exports;
  }
});
