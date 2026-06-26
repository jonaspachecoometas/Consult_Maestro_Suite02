import { useState, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/react/dashboard";
import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";
import AwsS3 from "@uppy/aws-s3";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UploadedFileInfo {
  fileName: string;
  fileType: string | null;
  fileSize: number;
  storageKey: string;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
    storageKey: string;
  }>;
  onFileUploaded?: (file: UploadedFileInfo) => Promise<void>;
  onComplete?: () => void;
  buttonClassName?: string;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 52428800,
  onGetUploadParameters,
  onFileUploaded,
  onComplete,
  buttonClassName,
  children,
  variant = "outline",
  size = "default",
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [uppy, setUppy] = useState<Uppy | null>(null);
  const storageKeysRef = useRef<Map<string, string>>(new Map());
  
  const onGetUploadParametersRef = useRef(onGetUploadParameters);
  const onFileUploadedRef = useRef(onFileUploaded);
  const onCompleteRef = useRef(onComplete);
  
  useEffect(() => {
    onGetUploadParametersRef.current = onGetUploadParameters;
    onFileUploadedRef.current = onFileUploaded;
    onCompleteRef.current = onComplete;
  }, [onGetUploadParameters, onFileUploaded, onComplete]);

  useEffect(() => {
    const uppyInstance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
      },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: async (file) => {
          const params = await onGetUploadParametersRef.current();
          storageKeysRef.current.set(file.id, params.storageKey);
          return { method: params.method, url: params.url };
        },
      })
      .on("upload-success", async (file) => {
        if (file && onFileUploadedRef.current) {
          const storageKey = storageKeysRef.current.get(file.id) || "";
          await onFileUploadedRef.current({
            fileName: file.name || "unknown",
            fileType: file.type || null,
            fileSize: file.size || 0,
            storageKey,
          });
          storageKeysRef.current.delete(file.id);
        }
      })
      .on("complete", () => {
        onCompleteRef.current?.();
        setShowModal(false);
      });

    setUppy(uppyInstance);

    return () => {
      uppyInstance.destroy();
    };
  }, [maxNumberOfFiles, maxFileSize]);

  const handleDialogChange = useCallback((open: boolean) => {
    setShowModal(open);
    if (!open && uppy) {
      uppy.cancelAll();
    }
  }, [uppy]);

  return (
    <>
      <Button 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        variant={variant}
        size={size}
        type="button"
      >
        {children}
      </Button>

      <Dialog open={showModal} onOpenChange={handleDialogChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enviar Arquivo</DialogTitle>
          </DialogHeader>
          {uppy && (
            <Dashboard
              uppy={uppy}
              proudlyDisplayPoweredByUppy={false}
              height={350}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
