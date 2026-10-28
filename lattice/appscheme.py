"""Apps run from a scheme of their own, lattice-app://, so they are their own sites: free to use the network and their
own storage, but a different origin from Lattice's page, which they cannot reach into (and Lattice's content policy,
which keeps its own page off the network, does not bind them). What the scheme serves: an app's files under apps/,
Lattice's bundled libraries under /_lattice/vendor/, and the copies of an app the app builder loads to check it.

What apps may not reach is this computer and the local network: the request interceptor refuses those requests from
an app, so an app can use the internet but not the services running here."""
from __future__ import annotations

import hashlib
import ipaddress
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import parse_qs

from PySide6.QtCore import QBuffer, QByteArray, QIODevice

from . import host
from PySide6.QtWebEngineCore import QWebEngineUrlRequestInterceptor, QWebEngineUrlRequestJob, QWebEngineUrlScheme, QWebEngineUrlSchemeHandler

SCHEME = b"lattice-app"
# Lattice's own files an app's site may load: bundled libraries, and the runtime for ChatGPT's widgets.
SHARED = {"vendor": host.APP / "ui" / "vendor", "widget": host.APP / "ui" / "widget"}
# The look Lattice is in, handed to each app as these variables (see the app-design skill).
LOOK = ("bg", "panel", "panel-hi", "surface", "surface-hover", "line", "line-soft", "text", "muted", "subtle", "accent", "accent-ink",
        "accent-glow", "ai", "ai-glow", "amber", "red", "green", "code-bg", "code-text", "shadow", "mono", "sans")


def register():
    """Before the application object exists: lattice-app:// is a secure, host-based scheme that fetch() may use. It is
    marked local, as Lattice's own file:// page may only frame local content; that page's remote access is left to its
    content policy (see main.py)."""
    if QWebEngineUrlScheme.schemeByName(SCHEME).name():
        return
    scheme = QWebEngineUrlScheme(SCHEME)
    scheme.setSyntax(QWebEngineUrlScheme.Syntax.Host)
    flags = QWebEngineUrlScheme.Flag.SecureScheme | QWebEngineUrlScheme.Flag.CorsEnabled | QWebEngineUrlScheme.Flag.LocalScheme
    if hasattr(QWebEngineUrlScheme.Flag, "FetchApiAllowed"):
        flags |= QWebEngineUrlScheme.Flag.FetchApiAllowed
    scheme.setFlags(flags)
    QWebEngineUrlScheme.registerScheme(scheme)


def host_of(rel):
    """Each app is a site of its own, the same one every time (its storage stays), named after its file."""
    return "a" + hashlib.sha1(rel.encode()).hexdigest()[:16]


def prelude(query, extra=""):
    """What comes first in an app's page: the look Lattice is in, and lattice.ask()."""
    theme = "light" if (query.get("theme") or [""])[0] == "light" else "dark"
    try:
        look = json.loads((query.get("look") or ["{}"])[0])
    except ValueError:
        look = {}
    tokens = "".join(f"--{k}:{v};" for k, v in (look.items() if isinstance(look, dict) else ())
                     if k in LOOK and isinstance(v, str) and not re.search(r"[;{}<>\\]", v) and len(v) < 200)
    return ('<meta charset="utf-8"><style id="lattice-look">:root{' + tokens + "color-scheme:" + theme + "}</style>"
            "<script>document.documentElement.dataset.theme=" + json.dumps(theme) + ";"
            'window.lattice={ask(text){parent.postMessage({lattice:"ask",text:String(text).slice(0,4000)},"*");}};</script>' + extra)


def with_prelude(html, pre):
    head = re.search(r"<head[^>]*>", html, re.I)
    if head:
        return html[:head.end()] + pre + html[head.end():]
    doctype = re.match(r"\s*<!doctype[^>]*>", html, re.I)
    return html[:doctype.end()] + pre + html[doctype.end():] if doctype else pre + html


def catcher(request, wait, probe):
    """Loaded ahead of an app being checked: it notes every error, runs the probe after the page has settled, and
    hands back what the page shows."""
    probe = probe.replace("</script", "<\\/script")
    return ("<script>window.__errors=[];const __err=console.error.bind(console);"
            'console.error=(...a)=>{__errors.push("console.error："+a.map(String).join(" "));__err(...a);};'
            # A ResizeObserver that settles over a few frames reports a harmless loop warning; it is not the app's error.
            'addEventListener("error",e=>{if(/ResizeObserver loop/.test(e.message||""))return;__errors.push(e.message?e.message+(e.lineno?"（第 "+e.lineno+" 行）":""):"加载不了："+(e.target?.src||e.target?.href||e.target?.tagName));},true);'
            'addEventListener("unhandledrejection",e=>__errors.push("未处理的 Promise："+String(e.reason?.message||e.reason)));'
            'addEventListener("load",()=>setTimeout(async()=>{let probe,probeError;'
            "if(window.__probe){try{probe=await window.__probe();}catch(e){probeError=String(e?.stack||e);}await new Promise(r=>setTimeout(r,150));}"
            "let shown;try{shown=probe===undefined?undefined:JSON.stringify(probe)?.slice(0,4000);}catch(e){shown=String(probe);}"
            "const d=document.documentElement;parent.postMessage({lattice_check:" + json.dumps(request) + ",errors:__errors.slice(0,30),title:document.title,"
            'text:(document.body?.innerText||"").slice(0,2500),size:{width:d.scrollWidth,height:d.scrollHeight},canvases:document.querySelectorAll("canvas").length,'
            'svgs:document.querySelectorAll("svg").length,buttons:document.querySelectorAll("button").length,inputs:document.querySelectorAll("input,select,textarea").length,'
            'images:[...document.images].map(i=>({src:i.currentSrc.slice(0,160),loaded:i.complete&&i.naturalWidth>0})).slice(0,20),'
            "probe:shown,probe_error:probeError},\"*\");}," + str(int(wait)) + "));</script>"
            + ("<script>window.__probe=async function(){\n" + probe + "\n};</script>" if probe.strip() else ""))


class AppScheme(QWebEngineUrlSchemeHandler):
    def __init__(self, bridge, parent=None):
        super().__init__(parent)
        self.bridge = bridge

    def requestStarted(self, job):
        url = job.requestUrl()
        path, host = url.path(), url.host()
        try:
            if path.startswith("/_lattice/"):
                body, mime = self._shared(path[len("/_lattice/"):])
            else:
                body, mime = self._app(host, path.lstrip("/"), parse_qs(url.query()))
        except (OSError, ValueError, UnicodeDecodeError):
            return job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)
        buffer = QBuffer(job)
        buffer.setData(QByteArray(body))
        buffer.open(QIODevice.OpenModeFlag.ReadOnly)
        job.reply(mime.encode(), buffer)

    @staticmethod
    def _shared(rel):
        folder, _, rest = rel.partition("/")
        base = SHARED.get(folder)
        target = (base / rest).resolve() if base else None
        if not target or not target.is_relative_to(base.resolve()) or not target.is_file():
            raise ValueError(rel)
        return target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream"

    def _app(self, host, rel, query):
        vault = self.bridge.lattice.vault
        if not rel.startswith("apps/") or ".." in rel.split("/"):
            raise ValueError(rel)
        mime = mimetypes.guess_type(rel)[0] or "application/octet-stream"
        if mime == "text/html":
            # The page itself gets the prelude: the one being checked comes from the check, the rest from apps/.
            check = self.bridge.app_docs.get(host)
            if check and check["file"] == rel:
                html, extra = check["html"], catcher(check["request"], check["wait"], check["probe"])
            else:
                html, extra = vault.read_text(rel), ""
            return with_prelude(html, prelude(query, extra)).encode(), "text/html; charset=utf-8"
        target = vault.path(rel).resolve()
        if not target.is_relative_to(vault.path("apps").resolve()) or not target.is_file():
            raise ValueError(rel)
        return target.read_bytes(), mime + ("; charset=utf-8" if mime.startswith("text/") or mime in ("application/javascript", "application/json") else "")


def _local(host):
    """This computer or the local network, by its name or address (names are not looked up)."""
    host = host.strip("[]").lower()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or "." not in host and ":" not in host:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    address = getattr(address, "ipv4_mapped", None) or address
    return address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified or address.is_multicast


class AppGuard(QWebEngineUrlRequestInterceptor):
    """An app may use the internet, not this computer, the local network, or another app's site."""

    def interceptRequest(self, info):
        origin = info.initiator()
        if origin.scheme() != SCHEME.decode():
            return
        url = info.requestUrl()
        if url.scheme() in ("http", "https", "ws", "wss"):
            info.block(_local(url.host()))
        elif url.scheme() == SCHEME.decode():
            info.block(url.host() != origin.host())
        else:
            info.block(url.scheme() not in ("data", "blob"))
