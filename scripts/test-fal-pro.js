import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

async function main() {
  try {
    const result = await fal.subscribe("fal-ai/flux-pro/v1.1", {
      input: {
        prompt: "A beautiful logo for a tech company",
        output_format: "jpeg",
        num_images: 1,
        aspect_ratio: "1:1"
      },
      logs: true,
      onQueueUpdate: (update) => console.log(update)
    });
    console.log("Success:", result);
  } catch (err) {
    console.error("Error:", err.message);
    if (err.response) {
      console.error("Details:", err.response.data);
    }
  }
}

main();
