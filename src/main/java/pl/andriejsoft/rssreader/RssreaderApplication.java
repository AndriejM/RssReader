package pl.andriejsoft.rssreader;

import io.mongock.runner.springboot.EnableMongock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@EnableMongock
public class RssreaderApplication {

	public static void main(String[] args) {
		SpringApplication.run(RssreaderApplication.class, args);
	}

}
