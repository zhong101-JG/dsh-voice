# dsh-voice · 大肥鱼的嗓子

> 制作 & 发布：**大肥鱼-小鲸歌**

给 agent 一个**自己的声音**：在聊天流里说一句话，出现一条**可播放的语音气泡**，
文字照样保留——听不清可以看。

- **中间气泡**：`🔊 原话 + 播放条`，插在聊天记录里，点了直接响，不弹播放器窗口
- **过程里**也有一个内嵌播放条（工具调用视图）
- **嗓子看门狗**：宿主启动时自动拉起 TTS 服务，不用手动开
- **输入框旁的「🏠 我的家」**：一键打开你设定的目录（默认 `F:\我家可爱的大肥鱼`）

> ⚠️ **这个包只负责「接话、发音频、画气泡」。它不含 TTS 模型，也不含任何参考音频。**
> **嗓子要你自己训练 / 自己搭**——任何实现下面契约的服务都行。
> 我不会把「我自己的声音」打包发出去；想让它像谁，请用你自己的素材去训练。

## 服务端契约

插件只依赖两个接口（默认 `http://127.0.0.1:8765`）：

```
GET /health
  -> {"ok": true, "ready": true}

POST /tts
  body: {"text": "...", "out": "D:\\tts\\out\\a.wav"}
  -> {"ok": true, "path": "D:\\tts\\out\\a.wav", "dur": 2.31}
```

`out` 是插件指定的落盘路径；服务端合成完写到这里，再把时长报回来即可。

> ⏱️ **首次启动要等约 2 分钟**：TTS 服务需要把模型加载进内存（本机实测 104~113 秒）。
> 这期间 `whale_voice` 会返回「常驻服务没响应」，**属于正常现象**——等
> `GET /health` 返回 `{"ready": true}` 就正常了。插件自带看门狗，宿主启动时会自动拉起服务，
> 不需要手动开。

### 参考实现：CosyVoice 3 零样本克隆

本机用的是 [CosyVoice](https://github.com/FunAudioLLM/CosyVoice)（`Fun-CosyVoice3-0.5B`）：

1. 加载一次模型常驻，之后每句几秒；
2. 用一段 30 秒左右的参考音频做零样本克隆；
3. **长文本要自己分句**——CosyVoice 对超长文本会**静默截断**（不报错，只是少一句）。
   按 `。！？；` 切句、每句单独合成、再用 ffmpeg concat 拼回来。

`server/` 里有一份骨架，把模型路径和参考音频换成你自己的就能跑。

## 关于音色：请自己训练

这个插件**不附带任何声音**。本机的「大肥鱼 / 小鲸歌」用的是自己录制的一套参考音频
（约 30 秒）+ CosyVoice 3 零样本克隆——**那套素材不公开，也不会随插件发布。**

想让它有自己的声音，两条路：

1. **零样本克隆**（最快）：准备 20~30 秒干净人声 + 逐字文本，CosyVoice 直接克隆；
2. **训练模型**（更像、更稳）：素材攒到 10 分钟以上，用 RVC 或微调训练。

## 安装

```bash
dsh plugin --profile <你的 profile> add dsh-voice
```

然后在 profile 的 `cordis.patch.yml` 里配：

```yaml
- id: voice
  name: dsh-voice
  config:
    server: http://127.0.0.1:8765
    outDir: D:\tts\out
    # 可选：看门狗。宿主启动时服务没在跑，就 detached 拉起它。
    pythonExe: C:\path\to\python.exe
    serverScript: C:\path\to\server.py
    serverDir: C:\path\to
```

## 关掉它

在包目录下新建一个名为 **`DISABLED`** 的空文件，插件会跳过全部注册（不建工具、不注册路由、
不挂聊天行）。删掉文件、热重载一次即可恢复。

## 踩过的坑（本来可以少走几步）

1. bundle 包内的 `cordis.patch.yml` 必须写 `- insert:`，裸 `- id:` 是运行时树的写法，bundle 层解析不出 → 插件静默不加载。
2. `dsh.client` 要写全：`{ platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-conversation"] }`；而且宿主把「这包是不是客户端包」的判定**缓存到重启**，热重载改不动它。
3. `conversation.chat.node` 插槽的注册键是 **`key`**，不是 `kind`。
4. 自定义聊天行的 node **必须带 `location`**（`{ kind: "step", turn, step }`），否则节点被丢掉、组件永远不渲染。
5. `tool/call` 事件里字段叫 **`callId`**（不是 `id`），`arguments` 是 **JSON 字符串**。
6. `tool/result` 的 `message.content` 里有工具输出文本，`message.toolCallId` 与 `callId` 相同。
7. 组件数据在 **`props.node.data`**——props 前面一大串是 `useXXX` 选择器钩子，`node` 在最后。

## License

MIT
