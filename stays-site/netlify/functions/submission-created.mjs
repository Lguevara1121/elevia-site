import { processSubmissionData } from "../../../netlify/functions/inquiry-intake.mjs";

export default async function handler(request) {
  const event = await request.json();
  const data = event?.payload?.data || event?.data || {};

  if (!data.email || !data.lead_type) {
    console.warn("Elevia inquiry submission is missing required fields");
    return;
  }

  try {
    await processSubmissionData(data);
  } catch (error) {
    console.error("Elevia inquiry submission event failed", error);
    throw error;
  }
}
