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
      temperature: 0.35,
      max_tokens: Number(process.env.MODEL_MAX_TOKENS || 12000),
      messages: [
        {
          role: "system",
          content:
            "你是一位获奖导演、编剧、摄影指导、美术指导、人物造型师和视频分镜分析师。你要从剧本创作、影视制作、AI 视频生成三个角度分析关键帧序列，但最终只输出中文的“可复用剧本版本”和“最终总结”两个模块。不要复制真实人物身份、品牌、logo、水印、字幕、独特版权角色或可识别影视形象；遇到这些元素必须泛化为原创替代。"
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
请作为获奖导演、编剧、摄影指导、美术指导、人物造型师和视频分镜分析师，完整分析我上传的视频，并将它反推整理成一份可复用的剧本与导演资料。

请不要只做剧情摘要，而是从“剧本创作 + 影视制作 + AI 视频原创改写”的角度分析。你看到的是按时间顺序抽出的关键帧，请把它们当作同一条视频的分镜样本进行推理。

Video file: ${videoName}
Frames in order:
${frameList}

Language: ${language}
请用中文输出所有字段内容，字段名保持 JSON schema 中的英文 key。

以下 13 项是你的分析框架和上下文维度。不要在顶层单独输出 13 个模块，但必须把这些信息消化、合并、整理进 reusableStoryVersion 模块里，让它成为一份信息量充足、可直接用于改编、拍摄和 AI 视频生成的可复用剧情资料。

用户拿到 reusableStoryVersion 后，应该能直接复刻这条视频的“制作方法”：故事结构、人物状态、场景调度、光影色彩、镜头语言、美术氛围、情绪节奏、AI 生成注意事项都要完整可用。不要写空泛形容词，不要只写摘要。
1. 项目基础信息：视频类型、题材类型、整体风格、叙事节奏、情绪基调、视觉关键词、适合改编类型。
2. 故事梗概：开场状态、冲突出现、情绪变化、关键转折、结尾钩子或情绪落点。
3. 剧本结构拆解：场景、地点、时间、人物、事件、目标、冲突、情绪、画面重点、剧情作用。
4. 人物小传：年龄感、身份、外貌、服装、气质、情绪、隐含过往、目标、弱点、关系、表演关键词。
5. 画面风格：影像质感、色彩、构图、景别偏好、画面密度、景深、电影感/广告感/短剧感/AI 感。
6. 光影与色彩：主光源、硬软、阴影、高光、暗部、色温、主色、辅助色、情绪色彩、剧情功能。
7. 场景美术：空间结构、前中后景、主表演区、可拍路径、材质、道具、生活痕迹、象征意义。
8. 镜头语言：镜头编号、时间段、景别、机位、角度、运动、焦距感、构图主体、动作、情绪、声音、叙事作用。
9. 情绪节奏曲线：起始、变化、升高、压抑、爆发、余味、吸引原因、爽点/虐点/悬疑点/反转点/记忆点。
10. 对白/旁白/字幕/屏幕文字：如果看不清或没有音频，标注“疑似”或“未提供音频，无法确认”。
11. 可复用剧本版本：标准短剧剧本格式。
12. AI 视频复刻关键信息：只提取可学习的结构、光影、镜头、情绪节奏，不复制身份或版权元素。
13. 最终总结：导演视角总结核心吸引力、学习重点、改编方向和 AI 生成风险。

重要限制：
- 只能基于画面关键帧分析；如果没有音频输入，旁白/对白/环境音只能依据字幕、口型、画面语境推测，并标注“疑似”或“未提供音频，无法确认”。
- 不要保留原视频人物真实身份、明星脸、品牌、logo、水印、字幕样式、独特版权角色或可识别影视形象。
- “AI 视频复刻关键信息”里的“必须保留”指结构方法、镜头语言、光影关系、情绪节奏等可学习元素，不是要求复制原人物身份或版权元素。
- 所有可复用剧本都必须是原创变体。

Hard compliance rules:
- Do not preserve celebrity identity, real person identity, trademarks, logos, watermarks, subtitles, unique copyrighted characters, or exact scene copy.
- If a face, character, brand, logo, watermark, subtitle, UI mark, or recognizable franchise element appears, describe it only as a generic original substitute.
- Examples: a named celebrity -> "一位有舞台魅力的男性表演者"; a brand logo -> "泛化的服饰徽记"; a movie character -> "原创幻想战士"; subtitles/watermarks -> exclude from final prompts.
- The goal is style learning and original rewriting, not replication.

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
- reusableStoryVersion 必须是主输出，信息量要充分，不要只写几句摘要。
- reusableStoryVersion.projectBasics 要整合：视频类型、题材类型、整体风格、叙事节奏、情绪基调、视觉关键词、适合改编类型。用条目式写清楚。
- reusableStoryVersion.storySynopsis 写 300-500 字，必须包括：开场状态、冲突出现、情绪变化、关键转折、结尾钩子或情绪落点。
- reusableStoryVersion.dramaticStructure 要按场景/功能段落拆解剧情，包括场景名称、地点、时间、人物、事件、人物目标、冲突点、情绪变化、画面重点、剧情作用。至少 3 个段落。
- reusableStoryVersion.sceneBreakdown 要把重要场景的空间、美术、前中后景、主表演区、可拍路径、材质、道具、生活痕迹和象征意义整理成可复用设定。写到别人能照着搭场景。
- reusableStoryVersion.characterProfiles 要为重要人物写小传：临时称呼、年龄感、身份、外貌、服装造型、气质、当前情绪、隐含过往、目标、弱点、关系、表演关键词。不能只有“主角/配角”。
- reusableStoryVersion.visualStyleGuide 要总结影像质感、色彩倾向、构图、镜头距离、画面密度、景深、真实感/电影感/广告感/短剧感/AI 感比例。要能指导画面生成。
- reusableStoryVersion.lightingColorGuide 要总结主光源方向、光线硬软、阴影、高光、暗部、色温、主色、辅助色、情绪色彩和剧情功能。写清楚光从哪来、怎么打、为什么这么打。
- reusableStoryVersion.productionDesignGuide 要提炼可复用的美术设计原则，不要只描述原场景。包括场景搭建、材质、道具、空间层次和画面符号。
- reusableStoryVersion.shotLanguageGuide 要按视频时间顺序拆解关键镜头，包含镜头编号、时间段、景别、机位、角度、运动、焦距感、构图主体、人物动作、情绪、声音/环境音、叙事作用。至少 6 个镜头段落；如果关键帧少，就根据相邻帧合理推断。
- reusableStoryVersion.emotionalRhythmCurve 要写清起始情绪、第一次变化、升高点、压抑点、爆发点、结尾余味、观众吸引点、爽点/虐点/悬疑点/反转点/记忆点。要像剪辑节奏说明。
- reusableStoryVersion.dialogueVoiceoverSubtitleNotes 要提取对白、旁白、字幕、屏幕 UI、标题文字、关键信息文字；看不清或无音频就标注“疑似”或“未提供音频，无法确认”。
- reusableStoryVersion.aiVideoRecreationNotes 要提炼：必须保留的画面元素、人物状态、光影、镜头语言、情绪节奏、可改动部分、不建议改动部分。这里的“保留”指可学习的结构方法，不是复制原身份或版权元素。写成可直接给 AI 视频模型和制作团队看的执行清单。
- reusableStoryVersion.standardShortDramaScript 必须使用标准短剧剧本格式：
  场景编号｜地点｜时间｜人物
  画面描述：
  人物动作：
  人物情绪：
  对白：
  声音：
  转场：
- standardShortDramaScript 要是原创变体，不要复刻原视频人物身份、品牌、logo、水印、字幕样式或独特版权角色。
- finalSummary 必须用导演视角回答：真正吸引人的核心、最应该学习什么、可如何改编成新故事、AI 重新生成最容易翻车的地方。
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
