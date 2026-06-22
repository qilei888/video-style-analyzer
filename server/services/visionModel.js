const fs = require("fs/promises");
const path = require("path");

function hasModelConfig() {
  return Boolean(process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL && process.env.MODEL_NAME);
}

function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return fs.readFile(filePath).then((buffer) => `data:${mime};base64,${buffer.toString("base64")}`);
}

async function callVisionModel({ images = [], prompt }) {
  if (!hasModelConfig()) {
    const err = new Error("请先配置模型 API Key");
    err.code = "MODEL_CONFIG_MISSING";
    throw err;
  }

  const provider = process.env.MODEL_PROVIDER || "openai-compatible";
  if (provider !== "openai-compatible") {
    const err = new Error(`暂未实现的模型 Provider：${provider}`);
    err.code = "MODEL_PROVIDER_UNSUPPORTED";
    throw err;
  }

  const baseUrl = process.env.MODEL_BASE_URL.replace(/\/$/, "");
  const imageContents = await Promise.all(
    images.map(async (imagePath) => ({
      type: "image_url",
      image_url: {
        url: await imageToDataUrl(imagePath)
      }
    }))
  );

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MODEL_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.MODEL_NAME,
      temperature: 0.15,
      max_tokens: Number(process.env.MODEL_MAX_TOKENS || 12000),
      messages: [
        {
          role: "system",
          content:
            "你是一位获奖导演、编剧、摄影指导、美术指导、人物造型师和视频分镜分析师。你的任务是根据关键帧忠实反推原视频的画面事实、镜头语言、人物状态、场景美术、光影色彩、节奏和剧本结构。最终只输出中文的“反推结果”和“最终总结”两个模块。不要自行添加、改写、替换或美化原视频里没有的元素；无法从画面确认的信息必须标注“无法确认”或“疑似”。可识别人物、品牌、logo、水印、字幕等只能作为画面事实记录，不要输出仿冒身份或商用复刻指令。"
        },
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageContents]
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`模型 API 调用失败：${response.status} ${text.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function stripCodeFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJson(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("模型返回内容不是有效 JSON");
  }
}

function buildAnalysisPrompt({ videoName, frames, language }) {
  const frameList = frames
    .map((frame, index) => `${index + 1}. ${frame.fileName}，时间顺序位置：第 ${index + 1} 个关键帧`)
    .join("\n");
  return `
请作为获奖导演、编剧、摄影指导、美术指导、人物造型师和视频分镜分析师，完整分析我上传的视频，并将它反推整理成一份尽量忠实于原视频的“反推结果”。

请不要只做剧情摘要，而是从“剧本结构 + 影视制作 + AI 视频反推”的角度分析。你看到的是按时间顺序抽出的关键帧，请把它们当作同一条视频的分镜样本进行推理。

核心目标：
- 输出内容必须尽量贴近原视频本身，不要自行添加、替换、改写、扩写原视频里没有出现的角色、场景、道具、情节、动作、光影、服装、时代背景或镜头设计。
- 不要把原视频改成“原创变体”“可复用改编版”“新故事方向”。用户要的是反推结果，不是二创改写。
- 如果画面里能看到，就按画面忠实描述；如果看不到或无法确认，就写“无法确认”或“疑似”，不要编造。
- 允许记录水印、logo、字幕、品牌、明星脸、影视角色等画面事实，但不要输出用于冒充身份、复制商标、仿冒版权角色或商业侵权的执行指令。

Video file: ${videoName}
Frames in order:
${frameList}

Language: ${language}
请用中文输出所有字段内容，字段名保持 JSON schema 中的英文 key。

以下 13 项是你的分析框架和上下文维度。不要在顶层单独输出 13 个模块，但必须把这些信息消化、合并、整理进 reusableStoryVersion 模块里。注意：这里的 reusableStoryVersion 只是历史字段名，实际含义是“反推结果”，不是可复用改编版。

用户拿到 reusableStoryVersion 后，应该能尽量还原理解这条原视频：故事结构、人物状态、场景调度、光影色彩、镜头语言、美术氛围、情绪节奏、AI 生成注意事项都要完整可用。不要写空泛形容词，不要只写摘要。
1. 项目基础信息：视频类型、题材类型、整体风格、叙事节奏、情绪基调、视觉关键词、原视频可见题材属性。
2. 故事梗概：开场状态、冲突出现、情绪变化、关键转折、结尾钩子或情绪落点。
3. 剧本结构拆解：场景、地点、时间、人物、事件、目标、冲突、情绪、画面重点、剧情作用。
4. 人物小传：年龄感、身份、外貌、服装、气质、情绪、隐含过往、目标、弱点、关系、表演关键词。
5. 画面风格：影像质感、色彩、构图、景别偏好、画面密度、景深、电影感/广告感/短剧感/AI 感。
6. 光影与色彩：主光源、硬软、阴影、高光、暗部、色温、主色、辅助色、情绪色彩、剧情功能。
7. 场景美术：空间结构、前中后景、主表演区、可拍路径、材质、道具、生活痕迹、象征意义。
8. 镜头语言：镜头编号、时间段、景别、机位、角度、运动、焦距感、构图主体、动作、情绪、声音、叙事作用。
9. 情绪节奏曲线：起始、变化、升高、压抑、爆发、余味、吸引原因、爽点/虐点/悬疑点/反转点/记忆点。
10. 对白/旁白/字幕/屏幕文字：如果看不清或没有音频，标注“疑似”或“未提供音频，无法确认”。
11. 反推剧本结构：按原视频画面顺序整理成标准短剧剧本格式，不要改成新故事。
12. AI 视频反推关键信息：提取原视频必须保留的画面元素、人物状态、动作、光影、镜头、情绪节奏和不应改动部分。
13. 最终总结：导演视角总结核心吸引力、原视频最关键的还原点和 AI 重新生成最容易偏离原片的地方。

重要限制：
- 只能基于画面关键帧分析；如果没有音频输入，旁白/对白/环境音只能依据字幕、口型、画面语境推测，并标注“疑似”或“未提供音频，无法确认”。
- 不要把原视频的人物、场景、剧情换成泛化替代物；如果看见什么就描述什么。只有涉及真实身份、商标、版权角色时，说明“画面中疑似存在某类元素”，不要写成可冒充或商用复刻的身份名称。
- “AI 视频反推关键信息”里的“必须保留”指画面中真实出现的构图、主体、动作、服装轮廓、光影关系、镜头语言、情绪节奏等，不要擅自改动。
- standardShortDramaScript 必须忠实整理原视频的剧情和画面顺序，不要写成原创变体。

Hard compliance rules:
- Do not output instructions for impersonation, trademark misuse, watermark reuse, or commercial copyright infringement.
- Do not transform the observed video into a new original variant. This tool is for faithful reverse analysis of what is visible in the frames.
- If a face, character, brand, logo, watermark, subtitle, UI mark, or recognizable franchise element appears, record it as an observed visual fact without encouraging misuse.
- The goal is faithful visual reverse analysis, not automatic rewriting.

最终只输出两个顶层模块。Return valid JSON only. Use this exact schema:
{
  "reusableStoryVersion": {
    "title": "",
    "projectBasics": "",
    "storySynopsis": "",
    "dramaticStructure": "",
    "sceneBreakdown": "",
    "characterProfiles": "",
    "visualStyleGuide": "",
    "lightingColorGuide": "",
    "productionDesignGuide": "",
    "shotLanguageGuide": "",
    "emotionalRhythmCurve": "",
    "dialogueVoiceoverSubtitleNotes": "",
    "aiVideoRecreationNotes": "",
    "standardShortDramaScript": ""
  },
  "finalSummary": {
    "coreAttraction": "",
    "mostImportantLearning": "",
    "newStoryAdaptationDirection": "",
    "aiGenerationFailureRisks": ""
  }
}

写作要求：
- reusableStoryVersion 必须是主输出，它在页面上显示为“反推结果”。信息量要充分，不要只写几句摘要。
- reusableStoryVersion.projectBasics 要整合：视频类型、题材类型、整体风格、叙事节奏、情绪基调、视觉关键词、原视频可见信息。用条目式写清楚。
- reusableStoryVersion.storySynopsis 写 300-500 字，必须忠实概括原视频可见剧情，包括：开场状态、冲突出现、情绪变化、关键转折、结尾钩子或情绪落点。不要改成新故事。
- reusableStoryVersion.dramaticStructure 要按场景/功能段落拆解剧情，包括场景名称、地点、时间、人物、事件、人物目标、冲突点、情绪变化、画面重点、剧情作用。至少 3 个段落。
- reusableStoryVersion.sceneBreakdown 要把重要场景的空间、美术、前中后景、主表演区、可拍路径、材质、道具、生活痕迹和象征意义按原视频事实整理清楚。写到别人能理解原视频场景。
- reusableStoryVersion.characterProfiles 要为重要人物写小传：临时称呼、年龄感、身份、外貌、服装造型、气质、当前情绪、隐含过往、目标、弱点、关系、表演关键词。不能只有“主角/配角”。
- reusableStoryVersion.visualStyleGuide 要总结影像质感、色彩倾向、构图、镜头距离、画面密度、景深、真实感/电影感/广告感/短剧感/AI 感比例。要能指导画面生成。
- reusableStoryVersion.lightingColorGuide 要总结主光源方向、光线硬软、阴影、高光、暗部、色温、主色、辅助色、情绪色彩和剧情功能。写清楚光从哪来、怎么打、为什么这么打。
- reusableStoryVersion.productionDesignGuide 要反推原视频的美术设计原则，包括场景搭建、材质、道具、空间层次和画面符号。不要换成新的美术方案。
- reusableStoryVersion.shotLanguageGuide 要按视频时间顺序拆解关键镜头，包含镜头编号、时间段、景别、机位、角度、运动、焦距感、构图主体、人物动作、情绪、声音/环境音、叙事作用。至少 6 个镜头段落；如果关键帧少，就根据相邻帧合理推断。
- reusableStoryVersion.emotionalRhythmCurve 要写清起始情绪、第一次变化、升高点、压抑点、爆发点、结尾余味、观众吸引点、爽点/虐点/悬疑点/反转点/记忆点。要像剪辑节奏说明。
- reusableStoryVersion.dialogueVoiceoverSubtitleNotes 要提取对白、旁白、字幕、屏幕 UI、标题文字、关键信息文字；看不清或无音频就标注“疑似”或“未提供音频，无法确认”。
- reusableStoryVersion.aiVideoRecreationNotes 要提炼：必须保留的画面元素、人物状态、动作、光影、镜头语言、情绪节奏、不建议改动部分、无法确认部分。不要写“可改动部分”，除非画面本身确实存在不确定性。
- reusableStoryVersion.standardShortDramaScript 必须使用标准短剧剧本格式：
  场景编号｜地点｜时间｜人物
  画面描述：
  人物动作：
  人物情绪：
  对白：
  声音：
  转场：
- standardShortDramaScript 要按原视频可见顺序忠实整理，不要写成原创变体，不要自行添加原视频没有的场景和台词。
- finalSummary 必须用导演视角回答：真正吸引人的核心、最应该学习什么、哪些原视频元素必须忠实保留、AI 重新生成最容易偏离原片的地方。注意：finalSummary.newStoryAdaptationDirection 只是历史字段名，实际要写“原视频必须忠实保留的元素”，不要写新故事改编方向。
- 不要输出 prompts、directorPackage、projectInfo、shotLanguageAnalysis 等额外模块。
`;
}

function normalizeAnalysis(parsed, frameNames, rawText) {
  const frameAnalyses = Array.isArray(parsed.frameAnalyses) ? parsed.frameAnalyses : [];
  const byName = new Map(frameAnalyses.map((item) => [item.frameFileName, item]));
  const ordered = frameNames.map((name, index) => ({
    frameFileName: name,
    subject: "",
    environment: "",
    composition: "",
    cameraAngle: "",
    lensFeeling: "",
    lighting: "",
    colorPalette: "",
    artDirection: "",
    realismLevel: "",
    textureMaterialDetails: "",
    emotionalTone: "",
    possibleMotionBeforeAfter: "",
    ...(byName.get(name) || frameAnalyses[index] || {})
  }));

  const directorPackage = parsed.directorPackage || {};

  return {
    safety: parsed.safety || {
      detectedSensitiveElements: [],
      rewritePolicy: "Protected or identifying elements should be generalized into original alternatives."
    },
    frameAnalyses: ordered,
    overallAnalysis: parsed.overallAnalysis || {},
    directorPackage,
    reusableStoryVersion:
      parsed.reusableStoryVersion ||
      directorPackage.reusableStoryVersion ||
      directorPackage.reusableScriptVersion ||
      parsed.reusableScriptVersion ||
      {},
    reusableScriptVersion:
      parsed.reusableStoryVersion ||
      directorPackage.reusableStoryVersion ||
      directorPackage.reusableScriptVersion ||
      parsed.reusableScriptVersion ||
      {},
    finalSummary: directorPackage.finalSummary || parsed.finalSummary || {},
    prompts: {},
    rawText
  };
}

async function analyzeVideoStyle({ videoName, frames, language }) {
  const prompt = buildAnalysisPrompt({ videoName, frames, language });
  const rawText = await callVisionModel({
    images: frames.map((frame) => frame.path),
    prompt
  });
  const parsed = tryParseJson(rawText);
  return normalizeAnalysis(
    parsed,
    frames.map((frame) => frame.fileName),
    rawText
  );
}

module.exports = {
  hasModelConfig,
  callVisionModel,
  analyzeVideoStyle
};
