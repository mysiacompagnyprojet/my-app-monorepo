//frontend/my-app/src/components/RecipeImagePreview
type Props = {
    imageUrl?: string | null
}

export function RecipeImagePreview({ imageUrl }: Props) {
    if (!imageUrl) return null

    return (
        <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                Aperçu de l’image
            </div>
            <img
                src={imageUrl}
                alt="Image de la recette"
                style={{
                    width: "100%",
                    maxWidth: 520,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.08)",
                    display: "block",
                }}
            />
        </div>
    )
}