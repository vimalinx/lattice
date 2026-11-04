import {$t} from "./i18n.js";
/* The interface starts here. Modules load in this order, which is also the order panel types are registered in. */
import "./i18n.js";
import "./state.js";
import "./core.js";
import "./theme.js";
import "./dock.js";
import "./spaces.js";
import "./editor.js";
import "./blocks.js";
import "./chat.js";
import "./imports.js";
import "./attach.js";
import "./files.js";
import "./notes.js";
import "./reader.js";
import "./books.js";
import "./marks.js";
import "./apps.js";
import "./skillstore.js";
import "./skillchange.js";
import "./side.js";
import "./panels.js";
import "./popups.js";
import "./app.js";
import "./a11y.js";
import {flushAll} from "./files.js";
import {flushLayout} from "./dock.js";
import {toast} from "./core.js";

// A separate window asks these of the page as it closes, from outside any module.
window.flushAll=flushAll;
window.flushLayout=flushLayout;

// What no one caught still reaches the log through the console; the learner is told once rather than left guessing.
let toldAt=0;
function uncaught(){if(Date.now()-toldAt>30000){toldAt=Date.now();toast($t("界面出了点问题，详情在日志里。可以继续用；不对劲时重开窗口。"),"error");}}
window.addEventListener("error",uncaught);
window.addEventListener("unhandledrejection",uncaught);
