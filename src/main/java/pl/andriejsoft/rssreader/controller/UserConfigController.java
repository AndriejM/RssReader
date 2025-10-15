package pl.andriejsoft.rssreader.controller;

import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pl.andriejsoft.rssreader.dto.UserConfigDto;
import pl.andriejsoft.rssreader.service.UserConfigService;

@RestController
@RequestMapping("/user-config")
public class UserConfigController {

  @Autowired
  private UserConfigService userConfigService;

  @GetMapping("/findAll")
  public List<UserConfigDto> getConfigs() {

    return userConfigService.findConfigAll();
  }

  @GetMapping("/find/{id}")
  public UserConfigDto getConfig(@PathVariable Long id) {

    return userConfigService.findConfigById(id);
  }

  @PostMapping("/add")
  public String saveConfig(@RequestBody UserConfigDto config) {
    userConfigService.saveConfig(config);
    return "Added Successfully";
  }

  @DeleteMapping("/delete/{id}")
  public String deleteConfig(@PathVariable Long id) {
    userConfigService.deleteConfigById(id);
    return "Deleted Successfully";
  }
}
