# Sign-in emails in every language

Not live until these are pasted into Supabase: **Authentication → Emails → Templates**, one template
at a time. Each block below replaces the whole body of that template, and the Subject goes in the box above it.
The English here replaces your current English, so keep yours if you've reworded it.

The app saves the language when an account is created (`language` in `src/auth.ts`), and Supabase's
[language guide](https://supabase.com/docs/guides/troubleshooting/customizing-emails-by-language-KZ_38Q.md) documents
this `.Data.language` pattern. Accounts created before this, and Google sign-ins, have no language, so they
get English. The language is saved once: changing it later in Settings doesn't change the emails.

## Test before pasting all three

1. Paste **Confirm signup** only, body and subject.
2. Sign up with a new address at `?lang=ca`. The email should be in Catalan, and the code and link should work.
3. In Supabase's Users table, check the account has `"language": "ca"` in `raw_user_meta_data`.
4. Sign up with another address without `?lang=`. That email should be in English.
5. **Check the subject line.** Supabase's docs don't say whether it accepts `if`. If it arrives with the
   `{{ if` showing, replace it with `Bito Chess` in all three templates.
6. Paste the other two.

## Confirm signup

Subject:

```
{{ if eq .Data.language "ca" }}Confirma el teu compte{{ else if eq .Data.language "es" }}Confirma tu cuenta{{ else if eq .Data.language "sv" }}Bekräfta ditt konto{{ else }}Confirm your Bito Chess account{{ end }}
```

Body:

```html
{{ if eq .Data.language "ca" }}
<h2>Confirma el teu compte de Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d’aquí a una hora.</p>
<p>També pots <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=signup">confirmar el compte amb aquest enllaç</a>.</p>
<p>Si no has creat cap compte, pots ignorar aquest correu.</p>
{{ else if eq .Data.language "es" }}
<h2>Confirma tu cuenta de Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=signup">confirmar la cuenta con este enlace</a>.</p>
<p>Si no has creado ninguna cuenta, puedes ignorar este correo.</p>
{{ else if eq .Data.language "sv" }}
<h2>Bekräfta ditt Bito Chess-konto</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=signup">bekräfta kontot med den här länken</a>.</p>
<p>Om du inte har skapat något konto kan du bortse från det här mejlet.</p>
{{ else }}
<h2>Confirm your Bito Chess account</h2>
<p>Your code: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Type it in Bito Chess. It expires after an hour.</p>
<p>You can also <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=signup">confirm with this link</a>.</p>
<p>If you didn’t create an account, you can ignore this email.</p>
{{ end }}
```

## Magic Link

Subject:

```
{{ if eq .Data.language "ca" }}Inicia sessió a Bito Chess{{ else if eq .Data.language "es" }}Inicia sesión en Bito Chess{{ else if eq .Data.language "sv" }}Logga in på Bito Chess{{ else }}Sign in to Bito Chess{{ end }}
```

Body:

```html
{{ if eq .Data.language "ca" }}
<h2>Inicia sessió a Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d’aquí a una hora.</p>
<p>També pots <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=magiclink">iniciar sessió amb aquest enllaç</a>.</p>
<p>Si no l’has demanat tu, pots ignorar aquest correu.</p>
{{ else if eq .Data.language "es" }}
<h2>Inicia sesión en Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=magiclink">iniciar sesión con este enlace</a>.</p>
<p>Si no lo has pedido tú, puedes ignorar este correo.</p>
{{ else if eq .Data.language "sv" }}
<h2>Logga in på Bito Chess</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=magiclink">logga in med den här länken</a>.</p>
<p>Om du inte har bett om det här kan du bortse från mejlet.</p>
{{ else }}
<h2>Sign in to Bito Chess</h2>
<p>Your code: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Type it in Bito Chess. It expires after an hour.</p>
<p>You can also <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=magiclink">sign in with this link</a>.</p>
<p>If you didn’t ask for this, you can ignore this email.</p>
{{ end }}
```

## Reset password

Subject:

```
{{ if eq .Data.language "ca" }}Canvia la contrasenya{{ else if eq .Data.language "es" }}Cambia tu contraseña{{ else if eq .Data.language "sv" }}Byt ditt lösenord{{ else }}Change your Bito Chess password{{ end }}
```

Body:

```html
{{ if eq .Data.language "ca" }}
<h2>Canvia la contrasenya de Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d’aquí a una hora.</p>
<p>També pots <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">canviar-la amb aquest enllaç</a>.</p>
<p>Si no l’has demanat tu, pots ignorar aquest correu. La contrasenya no canviarà.</p>
{{ else if eq .Data.language "es" }}
<h2>Cambia tu contraseña de Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">cambiarla con este enlace</a>.</p>
<p>Si no lo has pedido tú, puedes ignorar este correo. Tu contraseña no cambiará.</p>
{{ else if eq .Data.language "sv" }}
<h2>Byt ditt lösenord på Bito Chess</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">byta det med den här länken</a>.</p>
<p>Om du inte har bett om det här kan du bortse från mejlet. Lösenordet ändras inte.</p>
{{ else }}
<h2>Change your Bito Chess password</h2>
<p>Your code: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Type it in Bito Chess. It expires after an hour.</p>
<p>You can also <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">change it with this link</a>.</p>
<p>If you didn’t ask for this, you can ignore this email. Your password won’t change.</p>
{{ end }}
```
