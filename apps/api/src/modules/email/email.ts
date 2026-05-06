import { Unosend } from '@unosend/node';
import { env } from "../../env"

const unosend = new Unosend(env.UNOSEND_API_KEY);

export const sendMagicLinkEmail = async (to: string, magicLinkUrl: string) => {
    const { data, error } = await unosend.emails.send({
    from: env.UNOSEND_FROM_EMAIL,
    to: [to],
    subject: 'Magic Link',
    html: `<p>Click <a href="${magicLinkUrl}">here</a> to login</p>`
});

if (error) {
  console.error('Failed to send:', error.message);
  return;
}

    return data
}
