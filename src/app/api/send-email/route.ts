import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: Request) {
  try {
    const { para, nomeCliente, valor, anexoUrl } = await req.json();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Financeiro | Kaff Co." <${process.env.SMTP_USER}>`,
      to: para,
      subject: `Sua Nota Fiscal - Kaff Co.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #2563eb;">Olá, ${nomeCliente || 'Cliente'}!</h2>
          <p>Agradecemos a sua parceria. O pagamento no valor de <strong>R$ ${valor}</strong> foi processado.</p>
          <p>Sua Nota Fiscal já foi emitida e está disponível para download no link abaixo:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${anexoUrl}" style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Baixar Nota Fiscal</a>
          </div>
          <p style="font-size: 12px; color: #777;">Se você tiver alguma dúvida, basta responder a este e-mail.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erro no envio de e-mail:", error);
    return NextResponse.json({ error: 'Erro ao enviar email' }, { status: 500 });
  }
}
