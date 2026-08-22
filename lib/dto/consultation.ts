export type MedicineDispensedSummary = {
  id: string
  medicineName: string
  dosage: string | null
  quantity: number
  instructions: string | null
  dispensedFromStock: boolean
}

/** For the "collapsed list of past consultations" — §7.4's replacement for the index card. */
export type ConsultationSummaryDTO = {
  id: string
  queueEntryId: string
  date: Date
  doctorName: string
  chiefComplaint: string
  diagnosis: string | null
  followUpDate: Date | null
  medicines: MedicineDispensedSummary[]
}
