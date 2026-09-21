import { memo } from 'react'
import { Routes, Route } from 'react-router-dom'
import Inbox               from '../pages/comms/Inbox'
import EmailDetail         from '../pages/comms/EmailDetail'
import EmailComposer       from '../pages/comms/EmailComposer'
import DraftList           from '../pages/comms/DraftList'
import SentItems           from '../pages/comms/SentItems'
import Calendar            from '../pages/comms/Calendar'
import CalendarEventDetail from '../pages/comms/CalendarEventDetail'
import BookingPageList     from '../pages/comms/BookingPageList'
import BookingPageEditor   from '../pages/comms/BookingPageEditor'
import Contacts            from '../pages/comms/Contacts'
import ContactDetail       from '../pages/comms/ContactDetail'
import ContactImportWizard from '../pages/comms/ContactImportWizard'
import ContactMergeReview  from '../pages/comms/ContactMergeReview'
import ContactSyncSettings from '../pages/comms/ContactSyncSettings'
import SkillBuilder        from '../pages/comms/SkillBuilder'
import SkillList           from '../pages/comms/SkillList'
import LabelManager        from '../pages/comms/LabelManager'
import CategoryManager     from '../pages/comms/CategoryManager'
import RuleBuilder         from '../pages/comms/RuleBuilder'
import SharedMailboxSettings from '../pages/comms/SharedMailboxSettings'
import MailboxAssignQueue  from '../pages/comms/MailboxAssignQueue'
import AccountSettings     from '../pages/comms/AccountSettings'
import OOOSettings         from '../pages/comms/OOOSettings'

export default memo(function CommsModule() {
  return (
    <Routes>
      {/* Email */}
      <Route path="inbox"              element={<Inbox />} />
      <Route path="inbox/:threadId"    element={<EmailDetail />} />
      <Route path="compose"            element={<EmailComposer />} />
      <Route path="drafts"             element={<DraftList />} />
      <Route path="sent"               element={<SentItems />} />

      {/* Calendar */}
      <Route path="calendar"           element={<Calendar />} />
      <Route path="calendar/:eventId"  element={<CalendarEventDetail />} />

      {/* Booking Links (public-facing pages live at /book/:slug in App.jsx) */}
      <Route path="booking"            element={<BookingPageList />} />
      <Route path="booking/new"        element={<BookingPageEditor />} />
      <Route path="booking/:pageId"    element={<BookingPageEditor />} />

      {/* Contacts */}
      <Route path="contacts"              element={<Contacts />} />
      <Route path="contacts/import"       element={<ContactImportWizard />} />
      <Route path="contacts/merge"        element={<ContactMergeReview />} />
      <Route path="contacts/sync"         element={<ContactSyncSettings />} />
      <Route path="contacts/:contactId"   element={<ContactDetail />} />

      {/* AI Skills */}
      <Route path="skills"             element={<SkillList />} />
      <Route path="skills/new"         element={<SkillBuilder />} />
      <Route path="skills/:skillId"    element={<SkillBuilder />} />

      {/* Settings */}
      <Route path="labels"             element={<LabelManager />} />
      <Route path="categories"         element={<CategoryManager />} />
      <Route path="rules"              element={<RuleBuilder />} />
      <Route path="mailboxes"          element={<SharedMailboxSettings />} />
      <Route path="mailboxes/:mailboxId/queue" element={<MailboxAssignQueue />} />
      <Route path="accounts"           element={<AccountSettings />} />
      <Route path="ooo"                element={<OOOSettings />} />

      <Route index element={<Inbox />} />
    </Routes>
  )
})
