/** Mentions are routing markers in plain text; the colour is presentation only. */
export function MentionText({ text }) {
  return String(text).split(/(@(?:dudu|嘟嘟|claude|codex|chatgpt|deepseek|agent))(?=$|[\s,，:：.!?。！？)）])/giu)
    .map((part, index) => /^@(?:dudu|嘟嘟|claude|codex|chatgpt|deepseek|agent)$/iu.test(part)
      ? <span key={index} className="text-[#326bff]">{part}</span> : part);
}
