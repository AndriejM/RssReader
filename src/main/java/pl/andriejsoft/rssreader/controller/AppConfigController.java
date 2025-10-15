package pl.andriejsoft.rssreader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pl.andriejsoft.rssreader.dto.AppConfigDto;
import pl.andriejsoft.rssreader.service.AppConfigService;

@RestController
@RequestMapping("/app-config")
public class AppConfigController {

  @Autowired
  private AppConfigService appConfigService;

  @GetMapping("/getConfig")
  public AppConfigDto getAppConfig() {
    return appConfigService.getConfig();
  }

  @GetMapping("/setCurrentUser/{userId}")
  public AppConfigDto setCurrentUserConfig(@PathVariable Long userId) {
    return appConfigService.setCurrentUser(userId);
  }
}
