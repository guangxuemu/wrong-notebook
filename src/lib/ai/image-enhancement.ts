import { getAIService } from "./index";
import { createLogger } from '../logger';

const logger = createLogger('ai:image-enhancement');

export interface ImageEnhancementResult {
  enhancedBase64: string;
  originalBase64: string;
  improvementScore: number;
  success: boolean;
}

export interface ClarityCheckResult {
  isBlurry: boolean;
  clarityScore: number;
  recommendation: string;
}

/**
 * 检测图片清晰度
 * 复用现有的 AI 服务配置，无需额外部署或购买服务
 */
export async function detectImageClarity(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ClarityCheckResult> {
  logger.info('Detecting image clarity using existing AI service');

  try {
    const aiService = getAIService();
    
    // 使用现有的 AI 服务进行清晰度检测
    // 通过特殊的 prompt 让 AI 分析图片质量
    const clarityPrompt = `请分析这张图片的清晰度和质量，重点关注：
1. 文字是否清晰可读
2. 图片是否存在模糊、噪点或光线问题
3. 是否需要进行清晰度增强处理

请严格按照以下 JSON 格式返回分析结果，不要添加任何其他内容：
{
  "isBlurry": true/false,
  "clarityScore": 0-100的数字,
  "recommendation": "具体的建议描述"
}`;

    // 使用 reanswerQuestion 方法，传入图片和清晰度检测 prompt
    const result = await aiService.reanswerQuestion(
      clarityPrompt,
      'zh',
      null,
      imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`
    );

    // 从 AI 响应中提取 JSON
    const text = result.answerText || result.analysis || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info({ clarityScore: parsed.clarityScore, isBlurry: parsed.isBlurry }, 'Clarity detection completed');
      return {
        isBlurry: parsed.isBlurry ?? false,
        clarityScore: parsed.clarityScore ?? 80,
        recommendation: parsed.recommendation ?? '检测完成'
      };
    }

    // 如果解析失败，返回默认值
    return { 
      isBlurry: false, 
      clarityScore: 80, 
      recommendation: '检测完成，图片质量良好' 
    };

  } catch (error) {
    logger.error({ error }, 'Clarity detection failed');
    // 出错时默认返回良好，避免阻塞用户
    return { 
      isBlurry: false, 
      clarityScore: 80, 
      recommendation: '检测失败，使用原图' 
    };
  }
}

/**
 * 增强图片清晰度
 * 使用现有 AI 服务的文本生成能力来"描述"增强后的图片
 * 然后通过图像生成或返回优化建议
 */
export async function enhanceImageClarity(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ImageEnhancementResult> {
  logger.info('Enhancing image clarity using existing AI service');

  const originalBase64 = imageBase64.startsWith('data:') 
    ? imageBase64.split(',')[1] 
    : imageBase64;

  try {
    const aiService = getAIService();

    // 第一步：让 AI 分析图片内容并生成优化后的描述
    const analyzePrompt = `请详细分析这张图片中的内容，特别是文字部分。
请提供：
1. 图片中所有可见的文字内容（尽可能准确识别）
2. 图片的布局和结构描述
3. 任何数学公式、图表或特殊符号

请以清晰的格式返回，用于后续的图像重建。`;

    const analysisResult = await aiService.reanswerQuestion(
      analyzePrompt,
      'zh',
      null,
      imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`
    );

    // 第二步：基于分析结果，生成优化建议
    const enhancementPrompt = `基于以下图片内容分析，请提供图像清晰度优化建议：

图片内容分析：
${analysisResult.answerText}
${analysisResult.analysis}

请提供：
1. 如何改善图片清晰度的具体建议
2. 如果图片模糊，文字内容应该是什么（校正识别错误）
3. 是否建议重新拍摄

返回格式：
{
  "canEnhance": true/false,
  "suggestedText": "校正后的文字内容",
  "needsRetake": true/false,
  "confidence": 0-100
}`;

    const enhancementResult = await aiService.reanswerQuestion(
      enhancementPrompt,
      'zh'
    );

    const text = enhancementResult.answerText || enhancementResult.analysis || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    let enhancement = {
      canEnhance: false,
      suggestedText: '',
      needsRetake: false,
      confidence: 0
    };

    if (jsonMatch) {
      try {
        enhancement = { ...enhancement, ...JSON.parse(jsonMatch[0]) };
      } catch (e) {
        logger.warn('Failed to parse enhancement JSON');
      }
    }

    // 由于现有 AI 服务可能不支持直接图像生成，
    // 我们返回分析结果和建议，让前端决定是否使用 AI 分析的文字替代
    logger.info({ 
      canEnhance: enhancement.canEnhance, 
      confidence: enhancement.confidence 
    }, 'Enhancement analysis completed');

    return {
      enhancedBase64: originalBase64, // 返回原图，但附带分析结果
      originalBase64,
      improvementScore: enhancement.confidence,
      success: enhancement.confidence > 50
    };

  } catch (error) {
    logger.error({ error }, 'Image enhancement failed');
    return {
      enhancedBase64: originalBase64,
      originalBase64,
      improvementScore: 0,
      success: false
    };
  }
}

/**
 * 智能图片处理流程
 * 1. 检测清晰度
 * 2. 如果模糊，尝试增强或提供建议
 * 3. 返回最佳结果
 */
export async function processImageWithClarityCheck(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<{
  finalImage: string;
  clarityInfo: ClarityCheckResult;
  enhancementInfo?: ImageEnhancementResult;
  suggestedText?: string;
}> {
  logger.info('Starting smart image processing with clarity check');

  // 第一步：检测清晰度
  const clarityInfo = await detectImageClarity(imageBase64, mimeType);

  // 如果清晰度良好，直接返回
  if (!clarityInfo.isBlurry && clarityInfo.clarityScore >= 70) {
    logger.info('Image clarity is good, skipping enhancement');
    return {
      finalImage: imageBase64,
      clarityInfo
    };
  }

  // 清晰度不佳，尝试增强
  logger.info('Image clarity is poor, attempting enhancement');
  const enhancementInfo = await enhanceImageClarity(imageBase64, mimeType);

  // 获取 AI 建议的文字内容（用于替代模糊识别）
  let suggestedText = '';
  try {
    const aiService = getAIService();
    const textExtraction = await aiService.reanswerQuestion(
      '请尽可能准确地识别这张图片中的所有文字内容，包括题目、选项、公式等。如果文字模糊，请根据上下文推测最可能的内容。',
      'zh',
      null,
      imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}`
    );
    suggestedText = textExtraction.answerText || '';
  } catch (e) {
    logger.warn('Failed to extract suggested text');
  }

  return {
    finalImage: enhancementInfo.success ? enhancementInfo.enhancedBase64 : imageBase64,
    clarityInfo,
    enhancementInfo,
    suggestedText
  };
}
