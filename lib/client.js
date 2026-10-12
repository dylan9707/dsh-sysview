window.__ModuleLoader__.load({
  id: "dsh-sysview",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    var TAB_ID = "dsh-sysview/panel";
    var TAB_KIND = "dsh-sysview";

    function SystemViewPane() {
      return React.createElement("iframe", {
        src: "/plugins/sysview/editor",
        style: { width: "100%", height: "100%", border: "none", background: "#0B1220", display: "block" }
      });
    }

    exports.inject = ["slots"];

    exports.apply = function apply(ctx) {
      ctx.inject(["sidebarRight", "sidebarRightTabs"], function(native) {
        native.effect(function() {
          return native.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: function() { return "System View"; },
            guide: [
              {
                id: "system-view",
                title: function() { return "System View"; },
                description: function() { return "系统架构 / 信号流画布"; },
                order: 60
              }
            ]
          });
        });
        native.slots.inject("sidebar.right.pane.tab", function() {
          return native.slots.register({
            name: "sidebar.right.pane.tab",
            key: TAB_ID
          }, SystemViewPane);
        });
      });
    };

    return module.exports;
  }
});
