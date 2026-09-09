import { useRef, useState } from "react";
import { DOCUMENT_LIMITS } from "../../../../shared/protocol";
import { DocumentInputError, documentInputErrorMessage, prepareDocumentFiles, type DraftDocument } from "../document-attachments";
import { imageInputErrorMessage, prepareImageFiles, type DraftImage } from "../image-attachments";

export function useAttachments(isLoading: boolean, setSessionNotice: (notice: string) => void) {
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftDocuments, setDraftDocuments] = useState<DraftDocument[]>([]);
  const [isAddingImage, setIsAddingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  async function addImageFiles(files: readonly File[]) {
    if (files.length === 0 || isAddingImage || isLoading) return;
    if (draftImages.length + draftDocuments.length + files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
      setSessionNotice(`You can attach up to ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`);
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    setIsAddingImage(true);
    try {
      const prepared = await prepareImageFiles(files, draftImages);
      setDraftImages((current) => [...current, ...prepared]);
      setSessionNotice("");
    } catch (error) {
      setSessionNotice(imageInputErrorMessage(error));
    } finally {
      setIsAddingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function addAttachmentFiles(files: readonly File[]) {
    if (files.length === 0 || isAddingImage || isLoading) return;
    if (draftImages.length + draftDocuments.length + files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
      setSessionNotice(`You can attach up to ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (documentInputRef.current) documentInputRef.current.value = "";
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const documentFiles = files.filter((file) => !file.type.startsWith("image/"));
    setIsAddingImage(true);
    try {
      const [preparedImages, preparedDocuments] = await Promise.all([
        imageFiles.length > 0 ? prepareImageFiles(imageFiles, draftImages) : [],
        documentFiles.length > 0 ? prepareDocumentFiles(documentFiles, draftDocuments) : [],
      ]);
      setDraftImages((current) => [...current, ...preparedImages]);
      setDraftDocuments((current) => [...current, ...preparedDocuments]);
      setSessionNotice("");
    } catch (error) {
      setSessionNotice(error instanceof DocumentInputError
        ? documentInputErrorMessage(error)
        : imageInputErrorMessage(error));
    } finally {
      setIsAddingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  }

  return { draftImages, setDraftImages, draftDocuments, setDraftDocuments, isAddingImage, imageInputRef, documentInputRef, addImageFiles, addAttachmentFiles };
}
