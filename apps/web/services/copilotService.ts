

import { sendToCodeServerChatBox, type CopilotOptions } from './codeServerAutomation';

export async function sendCopilotPrompt(
  prompt: string,
  options?: CopilotOptions,
): Promise<string> {
  return await sendToCodeServerChatBox(prompt, options);
}
