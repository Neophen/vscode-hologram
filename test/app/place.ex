defmodule Octafest.Platform.Place do
  use Ash.Resource,
    otp_app: :octafest,
    domain: Octafest.Platform,
    data_layer: AshPostgres.DataLayer,
    authorizers: [Ash.Policy.Authorizer]

  postgres do
    table("places")
    repo(Octafest.Repo)
  end

  actions do
    defaults([
      :read,
      :destroy,
      create: [:title, :slug, :legacy_id],
      update: [:title, :slug, :legacy_id]
    ])
  end

  policies do
    policy action(:read) do
      authorize_if(actor_present())
    end

    policy action([:create, :update, :destroy]) do
      authorize_if(expr(^actor(:role) in [:octafest, :owner, :admin]))
    end
  end

  attributes do
    uuid_v7_primary_key(:id)

    attribute :title, :i18n_text do
      allow_nil?(false)
      public?(true)
    end

    attribute :slug, :i18n_text do
      public?(true)
    end

    attribute :legacy_id, :integer do
      public?(true)
    end

    timestamps()
  end

  identities do
    identity(:unique_legacy_id, [:legacy_id])
  end
end
