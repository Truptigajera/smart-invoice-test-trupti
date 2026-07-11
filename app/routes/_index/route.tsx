import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>InvoiceGST: Smart Invoicing</h1>
        <p className={styles.text}>
          GST-compliant invoices for Indian Shopify stores. Auto CGST/SGST/IGST, e-Invoice, GST Reports &amp; more.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Auto GST Calculation</strong>. Automatic CGST, SGST &amp; IGST split based on buyer&apos;s state.
          </li>
          <li>
            <strong>10+ Invoice Templates</strong>. Professional GST-compliant PDF invoices with your logo &amp; signature.
          </li>
          <li>
            <strong>GST Reports</strong>. Generate GSTR-1, GSTR-3B, B2B &amp; B2C CSV reports in one click.
          </li>
        </ul>
      </div>
    </div>
  );
}
