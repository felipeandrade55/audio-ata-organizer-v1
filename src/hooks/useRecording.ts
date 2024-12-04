import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { TranscriptionSegment } from "@/types/transcription";
import { voiceIdentificationService } from "@/services/voiceIdentificationService";
import { playIdentificationPrompt } from "@/services/audioService";
import { processTranscriptionResult } from "@/services/transcriptionService";
import { handleNameRecognition } from "@/services/nameRecognitionService";

export const useRecording = (apiKey: string) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [transcriptionSegments, setTranscriptionSegments] = useState<TranscriptionSegment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition | null>(null);
  const { toast } = useToast();
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);

  const startRecording = async (identificationEnabled: boolean) => {
    if (!apiKey) {
      toast({
        title: "Erro",
        description: "Por favor, insira sua chave da API OpenAI primeiro.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (identificationEnabled) {
        voiceIdentificationService.clear();
        await playIdentificationPrompt();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
        } 
      });
      
      const recorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];

      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const name = handleNameRecognition(transcript);
          
          if (name && !voiceIdentificationService.profiles.find(p => p.name === name)) {
            voiceIdentificationService.addProfile(name, new Float32Array(0));
            toast({
              title: "Novo participante identificado",
              description: `Identificamos o participante: ${name}`,
            });
          }
        }
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
        
        // Verifica se a gravação tem pelo menos 0.1 segundos
        if (!recordingStartTime || Date.now() - recordingStartTime < 100) {
          toast({
            title: "Aviso",
            description: "A gravação é muito curta. Por favor, grave por mais tempo.",
            variant: "destructive",
          });
          return;
        }

        setIsTranscribing(true);
        
        try {
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.wav');
          formData.append('model', 'whisper-1');
          formData.append('language', 'pt');
          formData.append('response_format', 'verbose_json');

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Falha na transcrição');
          }

          const result = await response.json();
          const segments = processTranscriptionResult(result);
          setTranscriptionSegments(segments);
          
          toast({
            title: "Transcrição concluída",
            description: "A ata da reunião está pronta.",
          });
        } catch (error) {
          console.error('Erro na transcrição:', error);
          toast({
            title: "Erro na transcrição",
            description: error instanceof Error ? error.message : "Não foi possível transcrever o áudio.",
            variant: "destructive",
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(1000);
      setRecordingStartTime(Date.now());
      setMediaRecorder(recorder);
      setIsRecording(true);
      setIsPaused(false);
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível acessar o microfone.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      if (speechRecognition) {
        speechRecognition.stop();
      }
      setIsRecording(false);
      setIsPaused(false);
      setMediaRecorder(null);
      setSpeechRecognition(null);
      setRecordingStartTime(null);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      if (speechRecognition) {
        speechRecognition.stop();
      }
      setIsPaused(true);
      toast({
        title: "Gravação pausada",
        description: "A gravação foi pausada. Clique em retomar para continuar.",
      });
    }
  };

  const resumeRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      if (speechRecognition) {
        speechRecognition.start();
      }
      setIsPaused(false);
      toast({
        title: "Gravação retomada",
        description: "A gravação foi retomada.",
      });
    }
  };

  return {
    isRecording,
    isPaused,
    isTranscribing,
    transcriptionSegments,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  };
};