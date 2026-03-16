defmodule Blog.MainLayout do
  use Hologram.Component

  alias Hologram.UI.Link
  alias Hologram.UI.Runtime

  prop :page_title, :string, default: "My Blog"

  def template do
    ~HOLO"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{@page_title}</title>
        <Runtime />
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>
        <nav class="navbar">
          <Link to={Blog.HomePage} class="logo">My Blog</Link>
          <div class="nav-links">
            <Link to={Blog.HomePage}>Home</Link>
            <Link to={Blog.AboutPage}>About</Link>
          </div>
        </nav>
        <main class="content">
          <slot />
        </main>
        <footer>
          <p>&copy; 2026 My Blog</p>
        </footer>
      </body>
    </html>
    """
  end
end
