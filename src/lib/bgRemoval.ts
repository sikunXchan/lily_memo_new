export async function removeImageBackground(base64Png: string): Promise<string> {
  const { removeBackground } = await import('@imgly/background-removal');
  const response = await fetch(`data:image/png;base64,${base64Png}`);
  const blob = await response.blob();
  const resultBlob = await removeBackground(blob);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(resultBlob);
  });
}
