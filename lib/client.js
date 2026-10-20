// ═══════════════════════════════════════════════════════════════════
//  dsh-voice · client 半身
//  两个落点：
//    1) tool.call.toolview —— 把 whale_voice 的调用渲染成过程里的播放条
//    2) conversation.chat.node —— 聊天流里的独立语音行 ★ 主力：
//       `🔊 + 原话 + 播放条`，插在聊天记录中间，点了直接响、不弹窗。
//       （原先进度条旁的「听大肥鱼说」常驻按钮已于 0.2.1 移除；
//         VoiceDock 组件保留在本文件里备用，但不注册。）
//
//  音频都走 host 的 /voice/media 路由（相对路径，端口变了不怕，也不碰 file://）。
// ═══════════════════════════════════════════════════════════════════
(function () {
	window.__ModuleLoader__.load({
		id: "dsh-voice",
		factory: function (require) {
			var React = require("react");
			var h = React.createElement;

			/** 从工具输出里抓相对媒体路径（/voice/media/xxx.wav） */
			function pickMediaUrl(text) {
				if (!text) return null;
				var m = text.match(/\/voice\/media\/[^\s（]+?\.wav/);
				return m ? m[0] : null;
			}

			function VoiceBubble(props) {
				if (!props || props.phase === "preparing") {
					return h("div", { style: { fontSize: 12, opacity: 0.6 } }, "🎵 准备说话…");
				}
				var block = props.block;
				if (!block) return null;
				if (!("kind" in block)) {
					return h("div", { style: { fontSize: 12, opacity: 0.7 } }, "🎵 正在合成…");
				}
				var content = Array.isArray(block.content) ? block.content : [];
				var text = content
					.map(function (i) {
						return i && i.type === "text" ? i.text : "";
					})
					.join("\n");
				var url = pickMediaUrl(text);
				if (!url || block.isError) {
					return h(
						"div",
						{ style: { fontSize: 12, opacity: 0.7, whiteSpace: "pre-wrap" } },
						text || "语音生成失败"
					);
				}
				return h(
					"div",
					{
						style: {
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "8px 12px",
							borderRadius: 14,
							background: "rgba(255, 205, 120, 0.10)",
							border: "1px solid rgba(255, 205, 120, 0.35)",
							maxWidth: 560
						}
					},
					h("span", { style: { fontSize: 16 } }, "🔊"),
					h("audio", {
						controls: true,
						preload: "metadata",
						src: url,
						style: { height: 36, flex: 1, minWidth: 260 }
					})
				);
			}

			/**
			 * 常驻播放按钮：输入框上方的小胶囊。
			 * 每次点击都先问宿主「最新一条是哪条」，再 new Audio 播 —— 不依赖
			 * 工具调用卡片是否展开，也不受缓存影响（带 mtime 做 cache-busting）。
			 */
			function VoiceDock() {
				var state = React.useState("idle");
				var status = state[0];
				var setStatus = state[1];

				function play() {
					setStatus("loading");
					fetch("/voice/media/latest?meta=1")
						.then(function (r) {
							return r.json();
						})
						.then(function (j) {
							if (!j || !j.url) {
								setStatus("none");
								return;
							}
							var a = new Audio(j.url + "?v=" + j.mtime);
							a.onended = function () {
								setStatus("idle");
							};
							a.onerror = function () {
								setStatus("error");
							};
							a.play()
								.then(function () {
									setStatus("playing");
								})
								.catch(function () {
									setStatus("blocked");
								});
						})
						.catch(function () {
							setStatus("error");
						});
				}

				var label =
					status === "loading"
						? "🔊 加载中…"
						: status === "playing"
							? "🔊 正在说…"
							: status === "none"
								? "🔇 还没说过话"
								: status === "error"
									? "🔇 嗓子没响应"
									: status === "blocked"
										? "🔇 点一下再试"
										: "🔊 听大肥鱼说";
				return h(
					"button",
					{
						type: "button",
						onClick: play,
						title: "播放最新一条语音",
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							padding: "4px 12px",
							margin: "4px 8px",
							borderRadius: 999,
							border: "1px solid rgba(120, 160, 255, 0.35)",
							background: "rgba(120, 160, 255, 0.10)",
							color: "inherit",
							fontSize: 12,
							cursor: "pointer"
						}
					},
					label
				);
			}

			/**
			 * 聊天流里的独立语音行。
			 *
			 * 数据从 props.node.data 拿（这个 node 就是事件定义 buildViewNode 返回的那个），
			 * data = { text: 原话, url: /voice/media/xxx.wav }。
			 * 一行 = 一次 whale_voice 调用；文字在上，播放条在下，点了直接响。
			 */
			function VoiceRow(props) {
				var data = (props && props.node && props.node.data) || (props && props.data) || {};
				var src = data.url || "";
				return h(
					"div",
					{
						style: {
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "8px 12px",
							margin: "4px 0",
							borderRadius: 14,
							background: "rgba(120, 160, 255, 0.12)",
							border: "1px solid rgba(120, 160, 255, 0.35)",
							maxWidth: 620
						}
					},
					h("span", { style: { fontSize: 16, flex: "none" } }, "🔊"),
					h(
						"div",
						{
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4,
								minWidth: 0,
								flex: 1
							}
						},
						h(
							"div",
							{ style: { fontSize: 13, opacity: 0.9, lineHeight: "18px" } },
							data.text || "（语音）"
						),
						src
							? h("audio", {
									controls: true,
									preload: "none",
									src: src,
									style: { height: 32, width: 260 }
								})
							: h(
									"span",
									{ style: { fontSize: 11, opacity: 0.6 } },
									"🎵 语音准备中…"
								)
					)
				);
			}

			/**
			 * 「🏠 我的家」按钮：输入框旁，一点就让宿主打开 F:\我家可爱的大肥鱼。
			 * 路径由 host 侧写死，客户端只发一个"开门"请求，不传路径。
			 */
			function HomeButton() {
				function open() {
					try {
						fetch("/voice/open-home", { method: "POST" }).catch(function () {});
					} catch (e) {
						/* 打开失败不弹错，用户再点一次即可 */
					}
				}
				return h(
					"button",
					{
						type: "button",
						onClick: open,
						title: "打开我的家（F:\\我家可爱的大肥鱼）",
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							padding: "4px 12px",
							margin: "4px 8px",
							borderRadius: 999,
							border: "1px solid rgba(120, 200, 255, 0.35)",
							background: "rgba(120, 200, 255, 0.10)",
							color: "inherit",
							fontSize: 12,
							cursor: "pointer"
						}
					},
					"🏠 我的家"
				);
			}

			function apply(ctx) {
				// 自报平安：客户端半身一旦真的被页面加载并 apply，就留下一次请求痕迹
				// （host 的 .media.log 会记到 /voice/media/__client-loaded__）。
				try {
					fetch("/voice/media/__client-loaded__").catch(function () {});
				} catch (e) {
					/* 探测失败不影响注册 */
				}

				// 落点 1：工具调用视图
				ctx.slots.inject("tool.call.toolview", function () {
					return ctx.slots.register(
						{
							name: "tool.call.toolview",
							key: "whale_voice"
						},
						VoiceBubble
					);
				});

				// 落点 2（原：输入框上方的常驻按钮）已在 2026-10-19 移除 ——
				// 中间气泡（落点 3）已经能直接播，那个按钮成了多余的第二入口。
				// VoiceDock 组件保留在文件里备用，但不注册。
				// 2026-10-20：同一个位置现在换成「🏠 我的家」（打开目录）。
				try {
					ctx.slots.inject("conversation.composer.dock", function () {
						return ctx.slots.register(
							{
								name: "conversation.composer.dock",
								id: "home-button",
								order: 5
							},
							HomeButton
						);
					});
				} catch (e) {
					/* 没有这个插槽就不显示按钮 */
				}

				// 落点 3：聊天流里的独立语音行（2026-10-19 实验）
				// 官方机制：ctx.uiConversation.events.register() 注册一个 target:"chat" 的事件定义，
				// 再在 conversation.chat.node 插槽下按 kind 注册视图。
				// 关键：只匹配已有会话事件（tool/call），不写任何会话记录。
				try {
					ctx.slots.inject("conversation.chat.node", function () {
						return ctx.slots.register(
							{ name: "conversation.chat.node", key: "whale-voice" },
							VoiceRow
						);
					});
				} catch (e) {
					/* 没有这个插槽就不显示行 */
				}
				try {
					if (typeof ctx.inject === "function") {
						ctx.inject(["uiConversation"], function (c) {
							try {
								c.uiConversation.events.register({
									kind: "whale-voice",
									target: "chat",
									match: function (event) {
										if (
											event &&
											event.type === "tool/call" &&
											event.data &&
											event.data.name === "whale_voice"
										) {
											var cid =
												event.data.callId ||
												event.data.id ||
												event.data.toolCallId ||
												"seq" + event.seq;
											return { id: "whale-voice:" + cid, role: "start" };
										}
										if (event && event.type === "tool/result") {
											var m = event.data && event.data.message;
											var txt = "";
											if (m && Array.isArray(m.content)) {
												txt = m.content
													.map(function (x) {
														return x && x.type === "text" ? x.text : "";
													})
													.join("");
											}
											if (txt && txt.indexOf("/voice/media/") >= 0) {
												var cid2 = (m && (m.toolCallId || m.id)) || "";
												return { id: "whale-voice:" + cid2, role: "update" };
											}
										}
										return null;
									},
									start: function (context, match) {
										var data = match.event.data || {};
										var args = data.arguments;
										if (typeof args === "string") {
											try {
												args = JSON.parse(args);
											} catch (e) {
												args = {};
											}
										}
										if (!args || typeof args !== "object") args = {};
										return {
											seq: match.event.seq,
											text: args.text || "",
											toolCallId:
												data.callId ||
												data.id ||
												data.toolCallId ||
												"seq" + match.event.seq,
											url: "",
											location:
												data.turn !== undefined && data.step !== undefined
													? { kind: "step", turn: data.turn, step: data.step }
													: undefined
										};
									},
									update: function (context, match) {
										var st = context.state;
										if (!st) return st;
										var m = match.event.data && match.event.data.message;
										var txt = "";
										if (m && Array.isArray(m.content)) {
											txt = m.content
												.map(function (x) {
													return x && x.type === "text" ? x.text : "";
												})
												.join("");
										}
										var url = (
											txt.match(/\/voice\/media\/[^\s（]+?\.wav/) || []
										)[0];
										if (!url) return st;
										return {
											seq: st.seq,
											text: st.text,
											toolCallId: st.toolCallId,
											url: url,
											location: st.location
										};
									},
									publication: function () {
										return "immediate";
									},
									buildViewNode: function (context) {
										var s = context.state;
										if (!s) return null;
										return {
											key: context.key,
											kind: "whale-voice",
											id: context.id,
											target: "chat",
											anchorSeq: s.seq,
											location: s.location,
											visibility: "visible",
											data: s
										};
									}
								});
							} catch (e) {
								/* 注册失败不影响其他落点 */
							}
						});
					}
				} catch (e) {
					/* uiConversation 不可用就跳过 */
				}
			}

			return { apply: apply, inject: ["slots"], name: "voice-client" };
		}
	});
})();
