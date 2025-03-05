import OpenAI from 'openai';
import { getGlobal } from '../global';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  username?: string;
}

type PredictionListener = (chatId: string, prediction: string) => void;

class OpenAIService {
  private openai: OpenAI;
  private static instance: OpenAIService;
  private messageHistory = new Map<string, Message[]>();
  private currentChatId: string | null = null;
  private currentUserId: string | null = null;
  private predictionListeners: Set<PredictionListener> = new Set();
  
  private constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true // Required for browser environment
    });
  }

  public static getInstance(apiKey: string): OpenAIService {
    if (!OpenAIService.instance) {
      OpenAIService.instance = new OpenAIService(apiKey);
    }
    return OpenAIService.instance;
  }

  public addPredictionListener(listener: PredictionListener) {
    this.predictionListeners.add(listener);
  }

  public removePredictionListener(listener: PredictionListener) {
    this.predictionListeners.delete(listener);
  }

  private notifyPredictionListeners(chatId: string, prediction: string) {
    this.predictionListeners.forEach(listener => listener(chatId, prediction));
  }

  public setCurrentUser(userId: string) {
    this.currentUserId = userId;
  }

  public setCurrentChat(chatId: string | null) {
    this.currentChatId = chatId;
    if (!chatId) {
      this.messageHistory.clear();
    }
  }

  public async predictMessage(chatId: string, messages: Message[]): Promise<string> {
    // Only predict for current active chat
    if (chatId !== this.currentChatId || !this.currentUserId) {
      console.log('Prediction skipped: wrong chat or no user', { chatId, currentChatId: this.currentChatId, currentUserId: this.currentUserId });
      return '';
    }

    // Don't predict if there are no messages
    if (!messages || messages.length === 0) {
      console.log('Prediction skipped: no messages');
      return '';
    }

    // Don't predict if AI is disabled in settings
    const global = getGlobal();
    if (!global.settings.byKey.isAiEnabled) {
      console.log('Prediction skipped: AI is disabled');
      return '';
    }

    try {
      // Store last 20 messages for this chat
      const recentMessages = messages.slice(-20);
      this.messageHistory.set(chatId, recentMessages);

      console.log('Processing messages:', recentMessages);

      // Format messages to include usernames and proper roles
      const formattedMessages = recentMessages.map(msg => {
        const isCurrentUser = msg.username === this.currentUserId;
        console.log('Processing message:', { username: msg.username, currentUserId: this.currentUserId, isCurrentUser });
        return {
          role: isCurrentUser ? 'assistant' as const : 'user' as const,
          content: msg.content // Отправляем только контент, без username
        };
      });

      // Don't make API call if there are no messages to predict from
      if (formattedMessages.length === 0) {
        console.log('Prediction skipped: no formatted messages');
        return '';
      }

      console.log('🤖 Sending to OpenAI:', formattedMessages);

      // Debug: Print full context
      console.log('🤖 Full OpenAI Context:', {
        systemPrompt: "You are participating in a Telegram chat conversation as the current user. Your task is to predict the next message that the current user would send, based on their speaking style and the conversation context. Keep responses natural and in character. Pay attention to the conversation flow. Respond in the same language as the conversation. Do not include any username prefixes in your response.",
        messages: formattedMessages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        currentUserId: this.currentUserId,
        chatId: this.currentChatId,
        totalMessages: formattedMessages.length,
      });

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system" as const,
            content: "You are participating in a Telegram chat conversation as the current user. Your task is to predict the next message that the current user would send, based on their speaking style and the conversation context. Keep responses natural and in character. Pay attention to the conversation flow. Respond in the same language as the conversation. Do not include any username prefixes in your response."
          },
          ...formattedMessages,
        ],
        max_tokens: 100,
        temperature: 0.7,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
      });

      const prediction = completion.choices[0]?.message?.content || '';
      console.log('Received prediction:', prediction);
      
      // Notify listeners about the new prediction
      this.notifyPredictionListeners(chatId, prediction);
      
      return prediction;
    } catch (error) {
      console.error('Error predicting message:', error);
      return '';
    }
  }

  public updateHistory(chatId: string, newMessage: Message): void {
    // Only update history for current active chat
    if (chatId !== this.currentChatId) {
      return;
    }

    const history = this.messageHistory.get(chatId) || [];
    history.push(newMessage);
    if (history.length > 20) {
      history.shift();
    }
    this.messageHistory.set(chatId, history);
  }

  public clearHistory(chatId: string): void {
    this.messageHistory.delete(chatId);
  }

  public clearPrediction() {
    // Clear the prediction for the current chat
    if (this.currentChatId) {
      this.messageHistory.delete(this.currentChatId);
      this.notifyPredictionListeners(this.currentChatId, '');
      console.log('Prediction cleared for chat:', this.currentChatId);
    }
  }

  public async regeneratePrediction(chatId: string, messages: Message[]) {
    // Only regenerate if AI is enabled
    const global = getGlobal();
    if (!global.settings.byKey.isAiEnabled) {
      console.log('Regeneration skipped: AI is disabled');
      return '';
    }

    return this.predictMessage(chatId, messages);
  }
}

export default OpenAIService; 