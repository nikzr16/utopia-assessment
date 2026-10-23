/**
 * Hand the browser a text file to save (the leaderboard CSV). The text keeps
 * its UTF-8 byte order mark so Excel reads names correctly.
 */
export function downloadTextFile(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Some browsers start the save after click() returns; free the file a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
