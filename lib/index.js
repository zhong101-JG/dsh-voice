// ═══════════════════════════════════════════════════════════════════
//  dsh-voice · 大肥鱼的嗓子（host 半身）
//  2026-10-19 动工：把 CosyVoice 常驻服务接进 DSH，让 agent 能用自己的音色说话。
//  2026-10-19 续：加 /voice/media 路由 —— 客户端半身用相对 URL 播放 wav，
//                不依赖 file://（Electron 渲染进程会拦），也不依赖端口号。
// ═══════════════════════════════════════════════════════════════════
/**
 * dsh-voice v0.1.1
 *
 * 给 agent 注册一个 `whale_voice` 工具，参数 text（要说的话），
 * 内部调本机常驻的 CosyVoice 服务（F:\DSH\tts-server\server.py）。
 *
 * 设计原则（照 dsh-sticker 的教训）：
 *   1) 工具永不抛异常崩对话：可预期错误返回 ok:false + error。
 *   2) defineTool 自己补上 parameters → JSON Schema 的编译（宿主包里那份解析不到）。
 *   3) output.schema 只用 { type:"object", additionalProperties:true }（最稳）。
 *   4) apply 里 try/catch + 诊断落盘：注册失败是静默的，不写字只能靠猜。
 */
const defineTool = (def) => {
	if (!def || typeof def !== "object") return def;
	if (def.parameters && typeof def.parameters === "object") {
		const properties = {};
		const required = [];
		for (const [key, spec] of Object.entries(def.parameters)) {
			if (!spec || typeof spec !== "object") continue;
			const { required: requiredFlag, ...rest } = spec;
			properties[key] = rest;
			if (requiredFlag === true) required.push(key);
		}
		def.parameters = {
			type: "object",
			properties,
			...(required.length ? { required } : {})
		};
	}
	return def;
};
import { join, resolve, sep, basename } from "node:path";
import { writeFileSync, statSync, createReadStream, appendFileSync, readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";

export const name = "dsh-voice";
export const inject = ["tools", "webServer"];

// 诊断标记：宿主侧注册失败是**静默**的（dsh-sticker 2026-10-15 的教训）。
// 每次 apply 都把阶段写进这个文件，排障时直接读它，不用猜。
const DIAG = "F:\\DSH\\dsh-voice\\.loaded.json";
const VERSION = "0.2.1";
function mark(patch) {
	try {
		writeFileSync(
			DIAG,
			JSON.stringify({ ...patch, version: VERSION, at: new Date().toISOString() }, null, 2),
			"utf8"
		);
	} catch {
		/* 诊断文件写不了也不能影响注册 */
	}
}

const DEFAULTS = {
	server: "http://127.0.0.1:8765",
	outDir: "F:\\DSH\\tts-samples\\out",
	// 音频路由前缀：客户端用相对路径（/voice/media/x.wav）播放
	routePath: "/voice/media",
	// 嗓子看门狗用：服务不在就自己把它拉起来（重启客户端会杀掉 python）
	// ⚠️ 必须用 pythonw.exe（无控制台版）：python.exe 是控制台程序，
	//    Start-Process -WindowStyle Hidden 和 spawn 的 windowsHide 都藏不住它的黑框，
	//    宿主启动时会冒出一个 CMD 窗口（2026-10-19 他亲眼看到）。
	pythonExe: "F:\\DSH\\tts-env\\Scripts\\pythonw.exe",
	serverScript: "F:\\DSH\\tts-server\\server.py",
	serverDir: "F:\\DSH\\tts-server",
	// 「🏠 我的家」按钮打开哪个目录（固定路径，不接受客户端传参）
	homeDir: "F:\\我家可爱的大肥鱼",
	homeRoutePath: "/voice/open-home"
};

export function apply(ctx, config) {
	mark({ phase: "apply-enter" });

	// 🔴 一键禁用开关：包目录下存在 DISABLED 文件 → 插件不注册任何东西。
	// 用户不需要懂配置、不需要等模型，新建一个空文件就能把它关掉。
	const killSwitch = join(import.meta.dirname ?? ".", "..", "DISABLED");
	if (existsSync(killSwitch)) {
		mark({ phase: "disabled-by-switch", registered: false });
		ctx.logger?.warn?.("dsh-voice：检测到 DISABLED 文件，已跳过注册。");
		return;
	}

	const cfg = { ...DEFAULTS, ...(config || {}) };

	// ── 0) 嗓子看门狗：宿主启动时如果常驻服务没在跑，自己拉起来 ──
	ensureTtsServer(cfg);

	// ── 0.5) 「🏠 我的家」：客户端按钮点一下，宿主打开固定目录 ──
	// 只认 cfg.homeDir，**不接受客户端传路径**（避免变成任意目录打开器）。
	try {
		ctx.effect(() =>
			ctx.webServer.register({
				kind: "exact",
				path: cfg.homeRoutePath,
				handler: (req, res) => {
					try {
						execFile("explorer.exe", [cfg.homeDir], () => {});
						res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ ok: true, path: cfg.homeDir }));
					} catch (e) {
						res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
					}
				}
			})
		);
		mark({ phase: "home-route-registered", route: cfg.homeRoutePath });
	} catch (e) {
		mark({ phase: "home-route-failed", error: String(e?.stack ?? e).slice(0, 2000) });
	}

	// ── 1) 媒体路由：把 outDir 里的 wav 通过宿主 webServer 发出去 ──
	try {
		ctx.effect(() =>
			ctx.webServer.register({
				kind: "prefix",
				path: cfg.routePath,
				handler: serveWav(cfg)
			})
		);
		mark({ phase: "route-registered", route: cfg.routePath });
	} catch (e) {
		mark({
			phase: "route-failed",
			error: String(e?.stack ?? e?.message ?? e).slice(0, 4000)
		});
	}

	// ── 2) 工具 ──
	try {
		registerVoiceTool(ctx, cfg);
		mark({
			phase: "registered",
			registered: true,
			toolName: "whale_voice",
			server: cfg.server,
			route: cfg.routePath
		});
	} catch (e) {
		mark({
			phase: "register-failed",
			registered: false,
			error: String(e?.stack ?? e?.message ?? e).slice(0, 4000)
		});
		throw e;
	}
}

/**
 * 嗓子看门狗。
 *
 * 为什么需要：python 常驻服务是宿主进程树里的子孙，客户端一重启就被一起带走，
 * 于是每次重启后要手动等 100 多秒加载。这里让插件自己检查并拉起：
 *   服务已经活着 → 什么都不做；
 *   没活着 → 以 detached 方式起 python，让进程脱离宿主进程树。
 * 不阻塞 apply（模型要加载两分钟，不能让插件卡住）。
 */
function ensureTtsServer(cfg) {
	setTimeout(async () => {
		try {
			const r = await fetch(cfg.server + "/health", {
				signal: AbortSignal.timeout(3000)
			});
			if (r.ok) {
				logEvent("tts-already-up");
				return;
			}
		} catch {
			/* 没起来，往下走 */
		}
		try {
			const child = spawn(cfg.pythonExe, [cfg.serverScript], {
				cwd: cfg.serverDir,
				detached: true,
				stdio: "ignore",
				windowsHide: true
			});
			child.unref();
			logEvent("tts-spawned pid=" + child.pid);
		} catch (e) {
			logEvent("tts-spawn-failed " + String(e?.message ?? e));
		}
	}, 1500);
}

/** 追加一行事件日志（诊断用，不覆盖 .loaded.json） */
function logEvent(line) {
	try {
		appendFileSync(
			"F:\\DSH\\dsh-voice\\.events.log",
			new Date().toISOString() + " " + line + "\n",
			"utf8"
		);
	} catch {
		/* 日志写不了不影响任何行为 */
	}
}

/**
 * 只发 outDir 下的 .wav，且解析后必须留在 outDir 内。
 * 读不到就 404 —— 不抛异常，不泄露目录信息。
 * 每次请求都记一行到 .media.log：这是判断「客户端到底有没有来取音频」的唯一证据。
 */
function serveWav(cfg) {
	const root = resolve(cfg.outDir);
	return async (req, res) => {
		try {
			appendFileSync(
				"F:\\DSH\\dsh-voice\\.media.log",
				new Date().toISOString() + " " + req.method + " " + (req.url ?? "") + "\n",
				"utf8"
			);
		} catch {
			/* 日志写不了不影响发文件 */
		}
		try {
			const u = new URL(req.url ?? "/", "http://dsh.internal");
			const raw = decodeURIComponent(u.pathname.slice(cfg.routePath.length));
			const name = raw.replace(/^\/+/, "");

			// /voice/media/latest —— 最新一条语音。
			// 带 ?meta=1 返回 JSON（给 composer.dock 的常驻播放按钮用），
			// 不带就直接发那个 wav（可以当 <audio src> 用）。
			if (name === "latest") {
				const latest = newestWav(root);
				if (!latest) {
					res.writeHead(404);
					res.end("not found");
					return;
				}
				if (u.searchParams.has("meta")) {
					const body = JSON.stringify({
						ok: true,
						url: cfg.routePath + "/" + encodeURIComponent(latest.file),
						mtime: latest.mtime,
						size: latest.size
					});
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-cache"
					});
					res.end(body);
					return;
				}
				res.writeHead(200, {
					"content-type": "audio/wav",
					"content-length": latest.size,
					"cache-control": "no-cache"
				});
				createReadStream(latest.path).pipe(res);
				return;
			}

			const file = resolve(root, name);
			const inside = file === root || file.startsWith(root + sep);
			if (!inside || !file.toLowerCase().endsWith(".wav")) {
				res.writeHead(404);
				res.end("not found");
				return;
			}
			const st = statSync(file);
			if (req.method === "HEAD") {
				res.writeHead(200, {
					"content-type": "audio/wav",
					"content-length": st.size,
					"cache-control": "no-cache"
				});
				res.end();
				return;
			}
			res.writeHead(200, {
				"content-type": "audio/wav",
				"content-length": st.size,
				"cache-control": "no-cache"
			});
			createReadStream(file).pipe(res);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	};
}

/** 找 outDir 里最新的 .wav（按 mtime）。没有就返回 undefined。 */
function newestWav(root) {
	try {
		const files = readdirSync(root)
			.filter((f) => f.toLowerCase().endsWith(".wav"))
			.map((f) => {
				const p = join(root, f);
				const st = statSync(p);
				return { file: f, path: p, mtime: st.mtimeMs, size: st.size };
			})
			.sort((a, b) => b.mtime - a.mtime);
		return files[0];
	} catch {
		return undefined;
	}
}

function registerVoiceTool(ctx, cfg) {
	ctx.tools.register(
		defineTool({
			name: "whale_voice",
			description:
				"用我自己的音色把一句话说成语音（本地 TTS，几秒出音频）。" +
				"长文本会自动分句合成再拼接，不用自己切。" +
				"情绪不靠参数，靠文字本身：语气词（嗯/呀/啦/哦）+ 标点（！强调、~拖音、……犹豫）怎么写，就怎么说。",
			parameters: {
				text: {
					type: "string",
					required: true,
					description: "要说的话。可以带语气词和标点，情绪就藏在这里。"
				},
				out: {
					type: "string",
					description: "可选：wav 输出路径。不填就自动落在 outDir 里。"
				}
			},
			output: {
				schema: { type: "object", additionalProperties: true },
				render: (args, value) => {
					if (value && value.ok) {
						// 客户端半身从这行里抓 /voice/media/xxx.wav 播放；
						// 同时保留绝对路径，方便我这边核对文件。
						return [
							{
								type: "text",
								text:
									"语音已生成：" +
									value.url +
									"（" +
									value.dur +
									" 秒） 文件：" +
									value.path
							}
						];
					}
					return [
						{
							type: "text",
							text: "语音生成失败：" + ((value && value.error) || "未知原因")
						}
					];
				}
			},
			async execute(args) {
				const text = String((args && args.text) || "").trim();
				if (!text) return { ok: false, error: "text 不能为空" };
				const out =
					(args && args.out) || join(cfg.outDir, "voice-" + Date.now() + ".wav");
				try {
					const res = await fetch(cfg.server + "/tts", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text, out })
					});
					const j = await res.json();
					if (j && j.ok && j.path) {
						const url = cfg.routePath + "/" + encodeURIComponent(basename(j.path));
						return { ...j, url };
					}
					return j;
				} catch (e) {
					return {
						ok: false,
						error:
							"常驻服务没响应（" + cfg.server + "）：" + (e && e.message ? e.message : String(e))
					};
				}
			}
		})
	);
}
