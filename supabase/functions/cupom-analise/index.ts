import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    return new Response(JSON.stringify({
      status: "prepared",
      provider_status: "configure-ocr-and-transcription",
      message: "Edge Function pronta. Conecte aqui o provedor real de OCR e transcrição.",
      received_attachments: attachments.length,
      suggested_direction: body.launch_type_target === "receita" ? "entrada" : "saida",
      ocr_text: null,
      audio_transcript: null,
      suggested_fields: {
        description: null,
        amount: null,
        date: null,
        category: null,
        notes: null
      },
      confidence_score: null
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: "failed", error: String(error && error.message || error) }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }
});
