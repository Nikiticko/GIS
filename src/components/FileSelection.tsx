import { useRef } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FileSelection({ id, files, disabled, onChange }: { id: string; files: File[]; disabled?: boolean; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="pending-files">
    <Input ref={input} id={id} className="attachments-input" type="file" multiple disabled={disabled} onChange={(event) => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (selected.length) onChange([...files, ...selected]);
    }} />
    <Button type="button" variant="outline" disabled={disabled} onClick={() => input.current?.click()}><Upload data-icon="inline-start" />Обрати файли</Button>
    {files.length ? <div className="pending-files-list">{files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`}><Paperclip /><span title={file.name}>{file.name}</span><Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Прибрати ${file.name}`} onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}><Trash2 /></Button></div>)}</div> : <span>Файли не вибрано</span>}
  </div>;
}
