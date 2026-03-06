//frontend/my-app/src/app/premium/cancel/page.tsx

export default function CancelPage() {
  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      <section className="app-card p-6 text-center">
        <h1 className="text-2xl font-extrabold app-title">
          Paiement annulé
        </h1>

        <p className="mt-3 app-muted">
          Aucun paiement n’a été effectué.
        </p>

        <p className="mt-2 app-muted">
          Tu peux réessayer quand tu le souhaites, sans aucune pression.
        </p>

        <div className="mt-5">
          <a href="/premium" className="app-btn-secondary">
            Retour à la page tarifs
          </a>
        </div>
      </section>
    </main>
  );
}

