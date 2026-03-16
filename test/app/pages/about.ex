defmodule Blog.AboutPage do
  use Hologram.Page

  route "/about"
  layout Blog.MainLayout

  def template do
    ~HOLO"""
    <div class="about-page">
      <h1>About This Blog</h1>
      <p>Built with the Hologram framework.</p>

      <h2>Features</h2>
      <ul>
        <li>Client-side state management</li>
        <li>Server-side commands</li>
        <li>Component-based architecture</li>
      </ul>
    </div>
    """
  end
end
