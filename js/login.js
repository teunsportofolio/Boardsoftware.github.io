const loginBtn = document.getElementById("loginBtn");
const loginOverlay = document.getElementById("loginOverlay");

loginBtn.addEventListener("click", () => {
  const name = document.getElementById("loginName").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!name || !password) {
    //alert("Please enter name and password.");
    //return;
    window.location.href = 'profile.html'; // path to your local HTML
  }
  if (password === "1234") {
     window.location.href = 'profile.html'; // path to your local HTML
  }
});