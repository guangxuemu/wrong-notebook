"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ImageClarityChecker } from "@/components/image-clarity-checker";
import { ParsedQuestion } from "@/lib/ai";
import { apiClient } from "@/lib/api-client";
import { AnalyzeResponse, Notebook, AppConfig } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { processImageFile } from "@/lib/image-utils";
import { ArrowLeft } from "lucide-react";
import { ProgressFeedback, ProgressStatus } from "@/components/ui/progress-feedback";
import { frontendLogger } from "@/lib/frontend-logger";

export default function AddErrorPage() {
    const params = useParams();
    const router = useRouter();
    const notebookId = params.id as string;
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const { t, language } = useLanguage();
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    const [config, setConfig] = useState<AppConfig | null>(null);

    // Cropper state
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);

    // Clarity checker state
    const [isClarityCheckerOpen, setIsClarityCheckerOpen] = useState(false);
    const [pendingImageBase64, setPendingImageBase64] = useState<string | null>(null);
    const [suggestedTextFromClarity, setSuggestedTextFromClarity] = useState<string | undefined>(undefined);

    // Timeout Config
    const aiTimeout = config?.timeouts?.analyze || 180000;
    const safetyTimeout = aiTimeout + 10000;

    // Cleanup Blob URL to prevent memory leak
    useEffect(() => {
        return () => {
            if (croppingImage) {
                URL.revokeObjectURL(croppingImage);
            }
        };
    }, [croppingImage]);

    useEffect(() => {
        // Fetch notebook info
        apiClient.get<Notebook>(`/api/notebooks/${notebookId}`)
            .then(data => setNotebook(data))
            .catch(err => {
                console.error("Failed to fetch notebook:", err);
                router.push("/notebooks");
            });

        // Fetch settings for timeouts
        apiClient.get<AppConfig>("/api/settings")
            .then(data => {
                setConfig(data);
                if (data.timeouts?.analyze) {
                    frontendLogger.info('[Config]', 'Loaded timeout settings', {
                        analyze: data.timeouts.analyze
                    });
                }
            })
            .catch(err => console.error("Failed to fetch config:", err));
    }, [notebookId, router]);

    // Simulate progress for smoother UX with timeout protection
    useEffect(() => {
        let interval: NodeJS.Timeout;
        let timeout: NodeJS.Timeout;
        if (analysisStep !== 'idle') {
            setProgress(0);
            interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 90) return prev;
                    return prev + Math.random() * 10;
                });
            }, 500);

            // Safety timeout: auto-reset after configurable time to prevent stuck overlay
            timeout = setTimeout(() => {
                console.warn('[Progress] Safety timeout triggered - resetting analysisStep');
                setAnalysisStep('idle');
            }, safetyTimeout);
        }
        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [analysisStep, safetyTimeout]);

    const onImageSelect = (file: File) => {
        const imageUrl = URL.createObjectURL(file);
        setCroppingImage(imageUrl);
        setIsCropperOpen(true);
    };

    const handleCropComplete = async (croppedBlob: Blob) => {
        setIsCropperOpen(false);
        const file = new File([croppedBlob], "cropped-image.jpg", { type: "image/jpeg" });
        
        // 压缩图片
        frontendLogger.info('[AddClarity]', 'Compressing image before clarity check');
        const base64Image = await processImageFile(file);
        setPendingImageBase64(base64Image);
        
        // 打开清晰度检测对话框
        setIsClarityCheckerOpen(true);
    };

    // 处理清晰度检测后的图片
    const handleClarityConfirm = (finalImage: string, suggestedText?: string) => {
        setIsClarityCheckerOpen(false);
        setCurrentImage(finalImage);
        setSuggestedTextFromClarity(suggestedText);
        
        // 继续 AI 分析流程
        handleAnalyzeWithImage(finalImage);
    };

    // 取消清晰度检测
    const handleClarityCancel = () => {
        setIsClarityCheckerOpen(false);
        // 如果取消，也继续分析（使用原图）
        if (pendingImageBase64) {
            setCurrentImage(pendingImageBase64);
            handleAnalyzeWithImage(pendingImageBase64);
        }
    };

    // 使用已有图片进行分析（清晰度检测后调用）
    const handleAnalyzeWithImage = async (base64Image: string) => {
        const startTime = Date.now();
        frontendLogger.info('[AddAnalyze]', 'Starting analysis flow with clarity-checked image', {
            timeoutSettings: {
                apiTimeout: aiTimeout,
                safetyTimeout
            }
        });

        try {
            frontendLogger.info('[AddAnalyze]', 'Step 1/4: Calling API endpoint /api/analyze');
            setAnalysisStep('analyzing');
            const apiStartTime = Date.now();
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language: language,
                subjectId: notebookId
            }, { timeout: aiTimeout });
            const apiDuration = Date.now() - apiStartTime;
            frontendLogger.info('[AddAnalyze]', 'API response received, validating data', {
                apiDuration
            });

            // Validate response data
            if (!data || typeof data !== 'object') {
                frontendLogger.error('[AddAnalyze]', 'Validation failed - invalid response data', {
                    data
                });
                throw new Error('Invalid API response: data is null or not an object');
            }
            frontendLogger.info('[AddAnalyze]', 'Response data validated successfully');

            // 如果有清晰度检测提供的建议文字，且 AI 识别的文字为空或不可靠，可以提示用户
            if (suggestedTextFromClarity && (!data.questionText || data.questionText.length < 10)) {
                frontendLogger.info('[AddAnalyze]', 'AI recognition might be incomplete, clarity suggestion available');
            }

            frontendLogger.info('[AddAnalyze]', 'Step 2/4: Setting processing state and progress to 100%');
            setAnalysisStep('processing');
            setProgress(100);
            frontendLogger.info('[AddAnalyze]', 'Progress updated to 100%');

            frontendLogger.info('[AddAnalyze]', 'Step 3/4: Setting parsed data into state');
            const dataSize = JSON.stringify(data).length;
            const setDataStart = Date.now();
            setParsedData(data);
            const setDataDuration = Date.now() - setDataStart;
            frontendLogger.info('[AddAnalyze]', 'Parsed data set successfully', {
                dataSize,
                setDataDuration
            });

            frontendLogger.info('[AddAnalyze]', 'Step 4/4: Switching to review page');
            const setStepStart = Date.now();
            setStep("review");
            const setStepDuration = Date.now() - setStepStart;
            frontendLogger.info('[AddAnalyze]', 'Step switched to review', {
                setStepDuration
            });
            const totalDuration = Date.now() - startTime;
            frontendLogger.info('[AddAnalyze]', 'Analysis completed successfully', {
                totalDuration
            });
        } catch (error: any) {
            const errorDuration = Date.now() - startTime;
            frontendLogger.error('[AddError]', 'Analysis failed', {
                errorDuration,
                error: error.message || String(error)
            });

            // 安全的错误处理逻辑
            try {
                let errorMessage = t.common.messages?.analysisFailed || 'Analysis failed';
                const backendErrorType = error?.data?.message;

                if (backendErrorType && typeof backendErrorType === 'string') {
                    if (t.errors && typeof t.errors === 'object' && backendErrorType in t.errors) {
                        const mappedError = (t.errors as any)[backendErrorType];
                        if (typeof mappedError === 'string') {
                            errorMessage = mappedError;
                        }
                    } else {
                        errorMessage = backendErrorType;
                    }
                } else if (error?.message) {
                    if (error.message.includes('fetch') || error.message.includes('network')) {
                        errorMessage = t.errors?.AI_CONNECTION_FAILED || '网络连接失败';
                    } else if (typeof error.data === 'string') {
                        errorMessage += ` (${error.status || 'Error'})`;
                    }
                }

                alert(errorMessage);
            } catch (innerError) {
                alert('Analysis failed. Please try again.');
            }
        } finally {
            setAnalysisStep('idle');
        }
    };

    const handleSave = async (finalData: ParsedQuestion & { subjectId?: string; gradeSemester?: string; paperLevel?: string }): Promise<void> => {
        if (!currentImage) {
            alert(t.common.messages?.missingImage || 'Missing image');
            return;
        }

        try {
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", {
                ...finalData,
                originalImageUrl: currentImage,
                subjectId: notebookId,
            });

            // 检查是否是重复提交（后端去重返回）
            if (result.duplicate) {
                frontendLogger.info('[AddSave]', 'Duplicate submission detected, using existing record');
            }

            alert(t.common.messages?.saveSuccess || 'Saved!');
            router.push(`/notebooks/${notebookId}`);
        } catch (error) {
            console.error(error);
            alert(t.common.messages?.saveFailed || 'Save failed');
        }
    };

    const getProgressMessage = () => {
        switch (analysisStep) {
            case 'compressing': return t.common.progress?.compressing || "Compressing...";
            case 'uploading': return t.common.progress?.uploading || "Uploading...";
            case 'analyzing': return t.common.progress?.analyzing || "Analyzing...";
            case 'processing': return t.common.progress?.processing || "Processing...";
            default: return "";
        }
    };

    if (!notebook) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-background">
            <ProgressFeedback
                status={analysisStep}
                progress={progress}
                message={getProgressMessage()}
            />

            <div className="container mx-auto p-4 space-y-8 pb-20">
                {/* Header Section */}
                <div className="flex items-center gap-4">
                    <Link href={`/notebooks/${notebookId}`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">{t.app.addError}</h1>
                </div>

                {/* Main Content */}
                {step === "upload" && (
                    <UploadZone onImageSelect={onImageSelect} isAnalyzing={analysisStep !== 'idle'} />
                )}

                {step === "review" && parsedData && currentImage && (
                    <CorrectionEditor
                        initialData={parsedData}
                        imagePreview={currentImage}
                        onSave={handleSave}
                        onCancel={() => setStep("upload")}
                        initialSubjectId={notebookId}
                        aiTimeout={aiTimeout}
                    />
                )}
            </div>

            <ImageCropper
                imageSrc={croppingImage || ""}
                open={isCropperOpen}
                onClose={() => setIsCropperOpen(false)}
                onCropComplete={handleCropComplete}
            />

            {/* 图片清晰度检测对话框 */}
            {pendingImageBase64 && (
                <ImageClarityChecker
                    imageBase64={pendingImageBase64}
                    open={isClarityCheckerOpen}
                    onConfirm={handleClarityConfirm}
                    onCancel={handleClarityCancel}
                />
            )}
        </main>
    );
}
