// Employee media slots, shared by the API and the admin panel (admin-panel/src/lib/media.ts mirrors this list).
// Single slots keep one file (a new upload replaces it); multiple slots collect any number of files.

export interface MediaSlot {
  key: string;
  label: string;
  group: string;
  multiple?: boolean;
}

export const MEDIA_SLOTS: MediaSlot[] = [
  { key: "profile_photo", label: "Profile photo", group: "Photo" },
  { key: "emirates_id_front", label: "Emirates ID — front", group: "Emirates ID" },
  { key: "emirates_id_back", label: "Emirates ID — back", group: "Emirates ID" },
  { key: "passport_front", label: "Passport — photo page", group: "Passport" },
  { key: "passport_back", label: "Passport — last page", group: "Passport" },
  { key: "visa_page", label: "Residence visa", group: "Visa & work permit" },
  { key: "entry_permit", label: "Entry permit", group: "Visa & work permit" },
  { key: "labour_card_front", label: "Labour card / work permit — front", group: "Visa & work permit" },
  { key: "labour_card_back", label: "Labour card / work permit — back", group: "Visa & work permit" },
  { key: "medical_fitness", label: "Medical fitness certificate", group: "Visa & work permit" },
  { key: "insurance_card", label: "Health insurance card", group: "Visa & work permit" },
  { key: "degree", label: "Degree / diploma", group: "Education", multiple: true },
  { key: "transcript", label: "Transcripts & attestations", group: "Education", multiple: true },
  { key: "professional_license", label: "Professional license (DHA / MOH / DOH)", group: "Professional", multiple: true },
  { key: "certificate", label: "Training certificates", group: "Professional", multiple: true },
  { key: "experience_letter", label: "Experience letters", group: "Professional", multiple: true },
  { key: "driving_license", label: "Driving license", group: "Other", multiple: true },
  { key: "other", label: "Other documents", group: "Other", multiple: true },
];

export const MEDIA_SLOT = new Map(MEDIA_SLOTS.map((s) => [s.key, s]));
/** Images and PDFs only. */
export const MEDIA_MIME = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;
