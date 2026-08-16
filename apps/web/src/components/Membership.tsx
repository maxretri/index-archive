import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

export function Membership() {
  const queryClient = useQueryClient();
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: api.subscription, staleTime: 10_000 });
  const [paymentStatus, setPaymentStatus] = useState("");
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["subscription"] });
  const checkout = useMutation({
    mutationFn: api.subscriptionCheckout,
    onSuccess: ({ invoiceLink }) => {
      const telegram = window.Telegram?.WebApp;
      if (!telegram?.openInvoice) {
        setPaymentStatus("OPEN INDEX IN TELEGRAM TO PAY");
        return;
      }
      telegram.openInvoice(invoiceLink, (status) => {
        if (status === "paid" || status === "pending") {
          setPaymentStatus(status === "paid" ? "PAYMENT RECEIVED · ACTIVATING" : "PAYMENT PROCESSING");
          void refresh();
          setTimeout(() => void refresh(), 1_500);
          setTimeout(() => void refresh(), 4_000);
        } else if (status === "failed") setPaymentStatus("PAYMENT FAILED · TRY AGAIN");
      });
    },
    onError: (error) => setPaymentStatus(error.message)
  });
  const cancel = useMutation({ mutationFn: api.cancelSubscription, onSuccess: refresh, onError: (error) => setPaymentStatus(error.message) });
  const resume = useMutation({ mutationFn: api.resumeSubscription, onSuccess: refresh, onError: (error) => setPaymentStatus(error.message) });
  const active = subscription.data?.plan === "plus";

  return <div className="membership-view">
    <section className="membership-hero">
      <span>{active ? "YOUR MEMBERSHIP" : "PRIVATE ARCHIVE MEMBERSHIP"}</span>
      <div className="membership-price"><strong>299</strong><p>TELEGRAM STARS<br />EVERY 30 DAYS</p></div>
      <p>{active ? "INDEX PLUS IS ACTIVE." : "SUPPORT INDEX AND KEEP YOUR ARCHIVE QUIET, INDEPENDENT AND AD-FREE."}</p>
      {!active && <button className="membership-buy" disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? "PREPARING" : "GET INDEX PLUS · 299 ★"}</button>}
      {active && <div className="membership-status">
        <span>ACTIVE UNTIL</span><strong>{formatPeriod(subscription.data?.currentPeriodEnd)}</strong>
        {subscription.data?.cancelAtPeriodEnd
          ? <button disabled={resume.isPending} onClick={() => resume.mutate()}>{resume.isPending ? "RESUMING" : "RESUME RENEWAL"}</button>
          : <button disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? "CANCELING" : "CANCEL RENEWAL"}</button>}
      </div>}
      {(paymentStatus || subscription.error) && <p className="membership-message">{paymentStatus || subscription.error?.message}</p>}
    </section>
    <section className="membership-benefits">
      <Benefit number="01" title="AD-FREE INDEX" state="AVAILABLE NOW" text="No internal sponsored placements anywhere in your private library." />
      <Benefit number="02" title="ZIP EXPORT" state="COMING NEXT" text="Download a collection or selected files in one archive." />
      <Benefit number="03" title="DOCUMENT SEARCH" state="COMING NEXT" text="Search text inside PDFs and documents." />
      <Benefit number="04" title="ASK INDEX" state="PLANNED" text="Natural-language search, automatic tags and intelligent collections." />
    </section>
    <p className="membership-terms">RECURRING SUBSCRIPTION. CANCEL ANYTIME; ACCESS CONTINUES TO THE END OF THE PAID PERIOD. BY SUBSCRIBING YOU ACCEPT THE <button onClick={() => window.Telegram?.WebApp.openLink(`${window.location.origin}/terms.html`)}>TERMS</button>.</p>
  </div>;
}

function Benefit({ number, title, state, text }: { number: string; title: string; state: string; text: string }) {
  return <article><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div><small>{state}</small></article>;
}

function formatPeriod(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
}
