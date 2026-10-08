// Inicializa o EmailJS
(function () {
  emailjs.init({
    publicKey: "KzZO1iAin6gqWCGhJ",
  });
})();

document
  .getElementById("confirmationForm")
  .addEventListener("submit", function (event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const confirmationMessage = document.getElementById(
      "confirmationMessage",
    );

    submitButton.disabled = true;
    submitButton.textContent = "Enviando...";
    confirmationMessage.className = "";
    confirmationMessage.textContent = "";

    emailjs
      .sendForm("service_nc79buo", "template_aizz974", form)
      .then(function () {
        confirmationMessage.className = "success";
        confirmationMessage.textContent = "Mensagem enviada com sucesso! Obrigada pelo contato.";
        form.reset();
      })
      .catch(function (error) {
        confirmationMessage.className = "error";
        confirmationMessage.textContent =
          "Não foi possível enviar sua mensagem. Confira sua conexão e tente novamente.";
        console.error("Erro ao enviar mensagem pelo EmailJS:", error);
      })
      .finally(function () {
        submitButton.disabled = false;
        submitButton.textContent = "Enviar mensagem";
      });
  });
