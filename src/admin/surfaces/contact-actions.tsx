import { Mail, MessageCircle, Phone } from 'lucide-react'
import { Button } from '@/admin/ui/button'

// A dialable form of a stored phone number: digits (plus a leading +) only, so "04171 998877"
// becomes a tel: target the OS dialer accepts.
const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`

// wa.me wants an international number with no plus or leading zero. German normalisation: a leading
// 00 is the international prefix, a leading 0 is the national trunk (→ 49). Best-effort (ADR-0023):
// wa.me only works for mobile numbers, so a landline opens an empty chat — shown anyway.
const whatsappHref = (phone: string): string => {
  const d = phone.replace(/\D/g, '')
  const intl = d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? `49${d.slice(1)}` : d
  return `https://wa.me/${intl}`
}

interface ContactActionsProps {
  email: string
  phone: string | null
}

// Contact facts as actions (ADR-0023): mailto / tel / WhatsApp — the buttons carry the address and
// number, so neither is shown as text. Call + WhatsApp appear only when a number is stored.
export const ContactActions = ({ email, phone }: ContactActionsProps) => (
  <div className="flex flex-wrap gap-2">
    <Button variant="outline" size="sm" asChild>
      <a href={`mailto:${email}`}>
        <Mail />
        E-Mail
      </a>
    </Button>
    {phone && (
      <Button variant="outline" size="sm" asChild>
        <a href={telHref(phone)}>
          <Phone />
          Anrufen
        </a>
      </Button>
    )}
    {phone && (
      <Button variant="outline" size="sm" asChild>
        <a href={whatsappHref(phone)} target="_blank" rel="noopener noreferrer">
          <MessageCircle />
          WhatsApp
        </a>
      </Button>
    )}
  </div>
)
