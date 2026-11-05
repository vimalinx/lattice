/* The state of the windows and the list of panel types. Everything else builds on these, and panels are registered as
   their modules load, so this module imports nothing and runs first. */
/* out: in the main window, the working states taken out into windows of their own (state id -> window id);
   own: in such a window, the state it holds. held: what every other window has open (window id, "" for the main one ->
   panels' parameters), so one panel is open in one window. */
export const Dock={layout:null,spaces:{},space:"chat",panels:{},els:{},types:{},focus:null,lastStack:{ai:null,mine:null},saveTimer:null,drag:null,origin:{},notice:new Set(),away:false,out:{},own:null,held:{}};
export function panelType(name,def){Dock.types[name]=def;}
