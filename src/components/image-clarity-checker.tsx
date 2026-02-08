"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, AlertCircle, CheckCircle, RefreshCw, Eye } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ClarityResult {
  isBlurry: boolean;
  clarityScore: number;
  recommendation: string;
}

interface EnhancementResult {
  clarity: ClarityResult;
  enhancement?: {
    success: boolean;
    improvementScore: number;
  };
  suggestedText?: string;
  image: {
    original: string;
    final: string;
  };
}

interface ImageClarityCheckerProps {
  imageBase64: string;
  onConfirm: (finalImage: string, suggestedText?: string) => void;
  onCancel: () => void;
  open: boolean;
}

export function ImageClarityChecker({ 
  imageBase64, 
  onConfirm, 
  onCancel, 
  open 
}: ImageClarityCheckerProps) {
  const { t } = useLanguage();
  const [isChecking, setIsChecking] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [result, setResult] = useState<EnhancementResult | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  // 检测清晰度
  const checkClarity = async () => {
    setIsChecking(true);
    try {
      const response = await apiClient.post<ClarityResult>("/api/image-clarity", {
        imageBase64,
        checkOnly: true
      });
      
      // 如果清晰度良好，直接确认
      if (!response.isBlurry && response.clarityScore >= 70) {
        onConfirm(imageBase64);
        return;
      }
      
      // 清晰度不佳，进行完整处理
      await processImage();
    } catch (error) {
      console.error("Clarity check failed:", error);
      // 出错时直接使用原图
      onConfirm(imageBase64);
    } finally {
      setIsChecking(false);
    }
  };

  // 处理图片（检测+增强）
  const processImage = async () => {
    setIsEnhancing(true);
    try {
      const response = await apiClient.post<EnhancementResult>("/api/image-clarity", {
        imageBase64,
        checkOnly: false
      });
      setResult(response);
    } catch (error) {
      console.error("Image processing failed:", error);
      // 出错时直接使用原图
      onConfirm(imageBase64);
    } finally {
      setIsEnhancing(false);
    }
  };

  // 当对话框打开时自动开始检测
  useEffect(() => {
    if (open && !hasStarted && imageBase64) {
      setHasStarted(true);
      checkClarity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasStarted, imageBase64]);

  // 当对话框关闭时重置状态
  useEffect(() => {
    if (!open) {
      setHasStarted(false);
      setResult(null);
      setShowComparison(false);
    }
  }, [open]);

  // 使用原图
  const handleUseOriginal = () => {
    onConfirm(imageBase64);
  };

  // 使用处理后的图片
  const handleUseEnhanced = () => {
    if (result) {
      onConfirm(result.image.final, result.suggestedText);
    }
  };

  // 重新检测
  const handleRecheck = () => {
    setResult(null);
    checkClarity();
  };

  // 获取清晰度颜色
  const getClarityColor = (score: number) => {
    if (score >= 80) return "text-green-600 bg-green-50 border-green-200";
    if (score >= 60) return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  // 获取清晰度标签
  const getClarityLabel = (score: number) => {
    if (score >= 80) return "清晰";
    if (score >= 60) return "一般";
    return "模糊";
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            图片清晰度检测
          </DialogTitle>
        </DialogHeader>

        {/* 初始状态：检测中 */}
        {(isChecking || isEnhancing) && !result && (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <p className="text-muted-foreground">
              {isChecking ? "正在检测图片清晰度..." : "正在分析并优化图片..."}
            </p>
          </div>
        )}

        {/* 检测结果 */}
        {result && (
          <div className="space-y-6">
            {/* 清晰度评分卡片 */}
            <Card className={getClarityColor(result.clarity.clarityScore)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {result.clarity.isBlurry ? (
                      <AlertCircle className="h-6 w-6" />
                    ) : (
                      <CheckCircle className="h-6 w-6" />
                    )}
                    <div>
                      <p className="font-semibold">
                        清晰度评分: {result.clarity.clarityScore}/100
                      </p>
                      <p className="text-sm opacity-80">
                        {result.clarity.recommendation}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-base px-3 py-1">
                    {getClarityLabel(result.clarity.clarityScore)}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* 图片对比 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">图片预览</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowComparison(!showComparison)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {showComparison ? "隐藏对比" : "显示对比"}
                </Button>
              </div>
              
              <div className={`grid gap-4 ${showComparison ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {/* 原图 */}
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground text-center">原始图片</p>
                  <div className="border rounded-lg overflow-hidden bg-muted">
                    <img
                      src={result.image.original}
                      alt="Original"
                      className="w-full h-48 object-contain"
                    />
                  </div>
                </div>
                
                {/* 增强后（如果有） */}
                {showComparison && result.enhancement?.success && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground text-center">
                      优化后 (置信度: {result.enhancement.improvementScore}%)
                    </p>
                    <div className="border rounded-lg overflow-hidden bg-muted border-primary">
                      <img
                        src={result.image.final}
                        alt="Enhanced"
                        className="w-full h-48 object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI 建议的文字内容 */}
            {result.suggestedText && (
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <h4 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    AI 识别的文字内容
                  </h4>
                  <div className="bg-white rounded p-3 text-sm text-blue-800 max-h-32 overflow-y-auto">
                    {result.suggestedText}
                  </div>
                  <p className="text-xs text-blue-600 mt-2">
                    如果图片中的文字识别不准确，可以使用 AI 识别的内容作为参考
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleRecheck}
                disabled={isChecking || isEnhancing}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                重新检测
              </Button>
              
              <div className="flex-1" />
              
              <Button
                variant="outline"
                onClick={handleUseOriginal}
                disabled={isChecking || isEnhancing}
              >
                使用原图
              </Button>
              
              <Button
                onClick={handleUseEnhanced}
                disabled={isChecking || isEnhancing}
                className="gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {result.enhancement?.success ? "使用优化结果" : "确认继续"}
              </Button>
            </div>
          </div>
        )}

        {/* 底部提示 */}
        <p className="text-xs text-muted-foreground text-center pt-4">
          使用系统已配置的 AI 服务进行图片分析，无需额外配置
        </p>
      </DialogContent>
    </Dialog>
  );
}
