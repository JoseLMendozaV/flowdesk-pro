/**
 * Markdown básico de las notas anteriores a la versión 2 (títulos, negrita, listas) a
 * HTML que Tiptap sabe leer. Todo el texto se escapa: no admite HTML del usuario.
 * La conversión solo se guarda cuando el usuario edita; el original queda en Historial.
 */
function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(text: string) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function markdownToHtml(markdown: string) {
  const html: string[] = [];
  let list: "ul" | "ol" | "task" | null = null;
  let code: string[] | null = null;
  const closeList = () => {
    if (list) html.push(list === "ol" ? "</ol>" : "</ul>");
    list = null;
  };
  const openList = (kind: "ul" | "ol" | "task") => {
    if (list === kind) return;
    closeList();
    html.push(kind === "ol" ? "<ol>" : kind === "task" ? '<ul data-type="taskList">' : "<ul>");
    list = kind;
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (code) {
      if (line.trim().startsWith("```")) {
        html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      closeList();
      code = [];
      continue;
    }
    const task = line.match(/^\s*[-*] \[( |x|X)\] (.*)$/);
    const bullet = line.match(/^\s*[-*] (.*)$/);
    const ordered = line.match(/^\s*\d+[.)] (.*)$/);
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (task) {
      openList("task");
      html.push(`<li data-type="taskItem" data-checked="${task[1] !== " "}"><p>${inline(task[2])}</p></li>`);
    } else if (bullet) {
      openList("ul");
      html.push(`<li><p>${inline(bullet[1])}</p></li>`);
    } else if (ordered) {
      openList("ol");
      html.push(`<li><p>${inline(ordered[1])}</p></li>`);
    } else {
      closeList();
      if (heading) html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) html.push("<hr>");
      else if (line.startsWith("> ")) html.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
      else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
      else html.push("<p></p>");
    }
  }
  if (code) html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
  closeList();
  return html.join("");
}
