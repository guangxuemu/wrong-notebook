import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { 
  detectImageClarity, 
  enhanceImageClarity,
  processImageWithClarityCheck 
} from "@/lib/ai/image-enhancement";
import { createLogger } from "@/lib/logger";
import { badRequest, internalError } from "@/lib/api-errors";

const logger = createLogger('api:image-clarity');

/**
 * POST /api/image-clarity
 * 图片清晰度检测和增强 API
 * 
 * 请求体：
 * {
 *   imageBase64: string,  // 图片 base64 数据
 *   mimeType?: string,    // 图片类型，默认 image/jpeg
 *   checkOnly?: boolean,  // 仅检测清晰度，不增强
 *   autoEnhance?: boolean // 自动增强（如果清晰度低于阈值）
 * }
 */
export async function POST(req: Request) {
  logger.info('Image clarity API called');

  const session = await getServerSession(authOptions);
  if (!session) {
    logger.warn('Unauthorized access attempt');
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    let { imageBase64, mimeType = "image/jpeg", checkOnly = false, autoEnhance = false } = body;

    if (!imageBase64) {
      logger.warn('Missing image data');
      return badRequest("Missing image data");
    }

    // 解析 Data URL
    if (imageBase64.startsWith('data:')) {
      const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageBase64 = matches[2];
        logger.debug({ mimeType, base64Length: imageBase64.length }, 'Parsed Data URL');
      }
    }

    // 仅检测清晰度
    if (checkOnly) {
      logger.info('Performing clarity check only');
      const clarityResult = await detectImageClarity(imageBase64, mimeType);
      return NextResponse.json(clarityResult);
    }

    // 完整处理流程：检测 + 增强
    logger.info('Starting full image processing with clarity check');
    const processResult = await processImageWithClarityCheck(imageBase64, mimeType);

    // 构建响应
    const response: any = {
      clarity: processResult.clarityInfo,
      image: {
        original: `data:${mimeType};base64,${imageBase64}`,
        final: processResult.finalImage.startsWith('data:') 
          ? processResult.finalImage 
          : `data:${mimeType};base64,${processResult.finalImage}`
      }
    };

    // 如果进行了增强，添加增强信息
    if (processResult.enhancementInfo) {
      response.enhancement = {
        success: processResult.enhancementInfo.success,
        improvementScore: processResult.enhancementInfo.improvementScore
      };
    }

    // 如果有建议的文字内容，添加
    if (processResult.suggestedText) {
      response.suggestedText = processResult.suggestedText;
    }

    logger.info({ 
      clarityScore: processResult.clarityInfo.clarityScore,
      isBlurry: processResult.clarityInfo.isBlurry,
      hasEnhancement: !!processResult.enhancementInfo
    }, 'Image processing completed');

    return NextResponse.json(response);

  } catch (error: any) {
    logger.error({ 
      error: error.message,
      stack: error.stack 
    }, 'Image clarity processing failed');
    
    return internalError("Failed to process image clarity");
  }
}
