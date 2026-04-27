const OpenAI = require('openai');
const logger = require('../utils/logger');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function transcribeAudio(buffer) {
  try {

    const file = await OpenAI.toFile(buffer, 'audio.ogg');

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe"
    });

    return transcription.text;

  } catch (error) {
    logger.error('Error in transcriptionService:', error);
    throw error;
  }
}

module.exports = { transcribeAudio };