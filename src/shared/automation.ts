export type CtripCheckInResult =
  Readonly<{ ok: true; checkIn: string }> | Readonly<{ ok: false; message: string }>;
