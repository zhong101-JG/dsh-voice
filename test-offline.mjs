// 离线验收：不起宿主，用假 ctx 把插件 apply 一遍，逐项检查它注册了什么、能不能干活。
// 跑法：node test-offline.mjs           （需要 F:\DSH\tts-server 正在监听 8765）
//       node test-offline.mjs --no-tts （只验注册，不合成）
import { apply, name, inject } from "file:///F:/DSH/dsh-voice/lib/index.js";

const noTts = process.argv.includes("--no-tts");

const tools = [];
const routes = [];
let effects = 0;

const ctx = {
	tools: {
		register: (def) => tools.push(def)
	},
	webServer: {
		register: (route) => {
			routes.push(route);
			return () => {};
		}
	},
	effect: (fn) => {
		effects += 1;
		const disposer = fn();
		return () => {
			if (typeof disposer === "function") disposer();
		};
	},
	logger: {
		warn: (m) => console.log("[warn]", m)
	}
};

const cfg = {
	server: "http://127.0.0.1:8765",
	outDir: "F:\\DSH\\tts-samples\\out"
};

console.log("== 1) 插件身份 ==");
console.log("name:", name, "| inject:", JSON.stringify(inject));
console.assert(name === "dsh-voice", "插件名不对");
console.assert(Array.isArray(inject) && inject.includes("tools"), "inject 缺 tools");

apply(ctx, cfg);

console.log("");
console.log("== 2) 工具注册 ==");
console.log("工具数:", tools.length);
const tool = tools.find((t) => t.name === "whale_voice");
console.assert(tool !== undefined, "whale_voice 没注册");
if (tool) {
	console.log("parameters:", JSON.stringify(tool.parameters));
	console.log("output.schema:", JSON.stringify(tool.output.schema));
	console.assert(tool.parameters && tool.parameters.type === "object", "parameters 没编译成 JSON Schema");
	console.assert(
		tool.parameters && Array.isArray(tool.parameters.required) && tool.parameters.required.includes("text"),
		"required 缺 text"
	);
}

console.log("");
console.log("== 3) 音频路由 ==");
console.log("路由数:", routes.length, "| effect 次数:", effects);
const route = routes.find((r) => r.path === "/voice/media");
console.assert(route !== undefined, "/voice/media 路由没注册");
console.assert(route && route.kind === "prefix", "路由 kind 应为 prefix");

console.log("");
console.log("== 4) 路由 handler：latest 元数据 ==");
if (route) {
	let got = "";
	const req = { method: "GET", url: "/voice/media/latest?meta=1" };
	const res = {
		writeHead: () => {},
		end: (body) => {
			got = String(body);
		}
	};
	await new Promise((resolve) => {
		route.handler(req, res);
		setTimeout(resolve, 1500);
	});
	console.log("返回:", got.slice(0, 220));
}

console.log("");
console.log("== 5) 合成（真实调用服务） ==");
if (tool && !noTts) {
	const r = await tool.execute({ text: "验收一句，大肥鱼的嗓子还在。" });
	console.log("结果:", JSON.stringify(r));
	console.assert(r && r.ok === true, "合成失败");
	console.assert(
		typeof r.url === "string" && r.url.indexOf("/voice/media/") === 0,
		"返回里缺 url"
	);
} else {
	console.log("（跳过）");
}

console.log("");
console.log("===== 验收结束 =====");
