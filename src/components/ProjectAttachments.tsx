import { useRef } from "react";
import { Eye, File, FileArchive, FileImage, FileText, Trash2, Upload } from "lucide-react";
import { type Attachment } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType === "application/pdf" || contentType.startsWith("text/")) return FileText;
  if (contentType.includes("zip") || contentType.includes("archive") || contentType.includes("compressed")) return FileArchive;
  return File;
}

function fileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} КБ`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} МБ`;
  return `${(size / 1024 ** 3).toFixed(1)} ГБ`;
}

function fileCount(count: number) {
  const lastTwo = count % 100, last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "файлів" : last === 1 ? "файл" : last >= 2 && last <= 4 ? "файли" : "файлів";
  return `${count} ${word}`;
}

export function ProjectAttachments({ attachments, projectId, canAdd, canDelete, busy, attachmentUrl, onUpload, onDelete }: {
  attachments: Attachment[];
  projectId: string;
  canAdd: boolean;
  canDelete: (attachment: Attachment) => boolean;
  busy: boolean;
  attachmentUrl: (projectId: string, attachmentId: string) => string;
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (attachment: Attachment) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <section className="attachments-section">
    <div className="attachments-heading">
      <div><strong>Вкладення</strong><span>{attachments.length ? fileCount(attachments.length) : "Файлів немає"}</span></div>
      {canAdd && <><Input ref={input} className="attachments-input" type="file" multiple disabled={busy} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length) void onUpload(files);
      }} /><Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload data-icon="inline-start" />{busy ? "Завантаження…" : "Додати файли"}</Button></>}
    </div>
    {attachments.length ? <div className="attachments-list">{attachments.map((attachment) => {
      const Icon = fileIcon(attachment.contentType);
      return <article className="attachment-item" key={attachment.id}>
        <div className="attachment-icon"><Icon /></div>
        <div className="attachment-info"><strong title={attachment.name}>{attachment.name}</strong><span>{fileSize(attachment.size)} · {formatDateTime(attachment.createdAt)}</span></div>
        <div className="attachment-actions">
          <Button render={<a href={attachmentUrl(projectId, attachment.id)} />} variant="outline" size="icon" aria-label={`Відкрити ${attachment.name}`} title="Відкрити у цій вкладці"><Eye /></Button>
          {canDelete(attachment) && <Button type="button" variant="destructive" size="icon" disabled={busy} aria-label={`Видалити ${attachment.name}`} title="Видалити" onClick={() => { if (window.confirm(`Видалити файл «${attachment.name}»?`)) void onDelete(attachment); }}><Trash2 /></Button>}
        </div>
      </article>;
    })}</div> : <div className="attachments-empty"><File /><span>До об’єкта ще не додано файлів.</span></div>}
  </section>;
}
