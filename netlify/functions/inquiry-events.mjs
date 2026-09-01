import { processSubmissionData } from "./inquiry-intake.mjs";

export default {
  async formSubmitted(event) {
    const data = event?.data || {};
    if (!data.email || !data.lead_type) return;

    try {
      await processSubmissionData(data);
    } catch (error) {
      console.error("Elevia inquiry form event failed", error);
      throw error;
    }
  },
};
