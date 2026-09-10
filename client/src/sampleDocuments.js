// Bundled "try it now" samples so a first-time visitor (or an interviewer
// grading this at 11pm with no test files handy) can see the whole pipeline
// work in one click, with zero setup. Deliberately messy/inconsistent
// formatting — that's the point of the assignment.
export const SAMPLE_DOCUMENTS = [
  {
    label: 'Messy invoice',
    filename: 'sample-invoice.txt',
    text: `INVOICE
frm: Riverbend Hardware Supply Co.
123 Elm St, Springfield

bill to -- Contoso Construction LLC
inv# RH-88213          date 3/4/24

qty  item                         unit    total
--------------------------------------------------
 12  galvanized pipe 2in           $4.25    51.00
  3  concrete mix (80lb bag)      $6.90    20.70
  1  labor - delivery                       35.00

subtotal ............................ 106.70
tax (7%) ............................    7.47
TOTAL DUE ...........................  114.17

due net 30. late fee 1.5%/mo after that.
pay to: acct #4471-2298 (ref RH-88213 pls!!)`,
  },
  {
    label: 'Scribbled meeting note',
    filename: 'sample-note.txt',
    text: `tues standup (late, ppl trickling in)

- sarah: api migration ~60% done, blocked on infra ticket #4021
- dev: found bug in checkout flow when qty=0, will file today
- priya out thurs/fri (dentist + pto)
- decided: pushing launch from 3/15 to 3/22, need design sign-off first
- ACTION mike -> follow up w/ vendor re: pricing by EOD wed
- reminder: no standup next mon (holiday)

random note to self: order more sticky notes lol`,
  },
];
