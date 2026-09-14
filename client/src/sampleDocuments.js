// One-click samples for the empty state. Someone opening this for the
// first time shouldn't have to go find a rental agreement before they can
// see whether it works.
//
// Both are chosen to exercise the parts that are actually hard, not to
// look tidy: the agreement contradicts itself about the deposit (so the
// review-and-confirm flow has something real to flag) and carries bank
// details (so the sensitivity warning fires); the prescription is written
// the way prescriptions actually are — abbreviated, dense, and carrying
// health data you wouldn't want to forward unwarned.
export const SAMPLE_DOCUMENTS = [
  {
    label: 'Rental agreement',
    filename: 'sample-rental-agreement.txt',
    text: `RESIDENTIAL TENANCY AGREEMENT (extract)

Landlord: Meridian Properties Ltd
Tenant: Jordan Lee
Premises: 44 Ashgrove Road, Flat 2B

3. RENT
Monthly rent of 1,450.00, payable on the 1st of each month by standing
order to sort code 60-15-22, account 41882901.

4. DEPOSIT
The Tenant shall pay a security deposit of 2,175.00 prior to occupation,
held with the Deposit Protection Service under reference DPS-88213-A.

SCHEDULE A — SUMS PAYABLE ON SIGNING
First month's rent ......... 1,450.00
Security deposit ........... 2,750.00
Total due on signing ....... 4,200.00

5. NOTICE
Either party may bring this tenancy to an end by giving two (2) months
written notice, such notice to be served no later than sixty (60) days
before the intended end date.

8. SUBLETTING
Subletting of the whole or any part of the premises is prohibited without
the Landlord's prior written consent.`,
  },
  {
    label: 'Prescription note',
    filename: 'sample-prescription.txt',
    text: `ST. AIDAN'S SURGERY — Dr. R. Mehta (GMC 4471229)

Pt: A. Kaur   DOB 14/03/1986   NHS 485 777 3456

Rx
1. Amoxicillin 500mg caps — TDS x 7/7
2. Prednisolone 5mg — 6 tabs OD x 5/7 then stop
3. Salbutamol inhaler 100mcg — 2 puffs PRN, max QDS

Review in 2/52 if no better. Do not take #2 on empty stomach.
Repeat not authorised.`,
  },
];
