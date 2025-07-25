<template>
  <div class="columns is-mobile is-centered is-vcentered foyer-background">
    <div class="column is-three-quarters-mobile is-two-thirds-tablet is-half-desktop is-one-third-widescreen">
      <form @submit.prevent="submit">
        <div class="card">
          <header class="card-header">
            <p class="card-header-title">
              {{ $t("create_a_account_with_upstage") }}
            </p>
          </header>
          <div class="card-content">
            <div class="content">
              <Field v-model="form.username" left="fas fa-user" placeholder="Username" required
                requiredMessage="Username is required" :touched="touched" />
              <Password v-model="form.password" left="fas fa-lock" placeholder="Password" required
                requiredMessage="Password is required" :touched="touched" />
              <Password v-model="form.confirmPassword" left="fas fa-lock" placeholder="Confirm Password"
                :error="confirmPasswordError" />
              <div class="columns">
                <div class="column pr-0 pb-0">
                  <Field v-model="form.firstName" left="fas fa-user" placeholder="First Name" />
                </div>
                <div class="column pb-0">
                  <Field v-model="form.lastName" placeholder="Last Name" />
                </div>
              </div>
              <Field v-model="form.email" left="fas fa-envelope" placeholder="Email" type="email" required
                requiredMessage="Email is required" :touched="touched" />
              <Field v-model="form.intro"
                placeholder="Please say briefly who you are and why you would like an UpStage account." type="textarea"
                required requiredMessage="Introduction is required" :touched="touched" />
              <label class="checkbox">
                <input type="checkbox" v-model="agreed" />
                {{ $t("tos.register") }}
                <TermsOfService />.
              </label>
              <turnstile v-if="isProduction" ref="captcha" :site-key="siteKey" v-model="form.token" />
            </div>
          </div>
          <footer class="card-footer">
            <button class="card-footer-item is-white button has-text-primary" :class="{ 'is-loading': loading }"
              type="submit">
              <span>{{ $t("register") }}</span>
              <span class="icon is-medium">
                <i class="fas fa-check"></i>
              </span>
            </button>
          </footer>
        </div>
      </form>
    </div>
  </div>
</template>

<script>
import Field from "components/form/Field.vue";
import Password from "components/form/Password.vue";
import TermsOfService from "components/TermsOfService.vue";
import { computed, reactive, ref } from "vue";
import { useMutation } from "services/graphql/composable";
import { userGraph } from "services/graphql";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import Turnstile from "vue-turnstile";
import configs from "config";

export default {
  components: { Field, Password, TermsOfService, Turnstile },
  setup: () => {
    const router = useRouter();
    const form = reactive({});
    const { mutation, loading } = useMutation(userGraph.createUser, form);
    const confirmPasswordError = computed(() =>
      form.password !== form.confirmPassword
        ? "Confirm password mismatch"
        : ((form.password || "").length < 8 ? "Make your password at least 8 characters long" : false),
    );
    const touched = ref(false);
    const agreed = ref(false);
    const captcha = ref();

    const submit = async () => {
      touched.value = true;
      if (!form.username || !form.password || !form.email || (form.password || "").length < 8) return;
      if (confirmPasswordError.value) return;
      if(form.username.length < 5) {
        message.error("Make your user name at least 5 characters long");
        return;
      }
      if (configs.MODE === 'Production' && !form.token) {
        return
      }
      else form["token"] = null
      if (!agreed.value) {
        message.error("Please agree to the Terms & Conditions");
        return;
      }
      try {
        const response = await mutation();
        message.success(
          "Thank you for registering. Your account needs to be approved by an Admin - please check your email.",
        );
        router.push("/login");
      } catch (error) {
        captcha.value?.reset();
        if (error.includes("upstage_user_username_key")) {
          message.error("Username " + form.username + " already exists!");
        } else if (error.includes("upstage_user_email_key")) {
          if (form.email) {
            message.error("Email " + form.email + " already exists!");
          } else {
            message.error("Email is required!");
          }
        } else {
          message.error(error);
        }
      }
    };

    return {
      form,
      loading,
      submit,
      confirmPasswordError,
      touched,
      agreed,
      siteKey: configs.CLOUDFLARE_CAPTCHA_SITEKEY,
      isProduction: configs.MODE === 'Production',
      captcha,
    };
  },
};
</script>

<style>
.clickable {
  pointer-events: all;
}
</style>
